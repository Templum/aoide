/**
 * Eval-specific response cache for judge and embedding calls.
 *
 * Stored separately from the application snapshot cache
 * (`__prompt_snapshots__/eval/` vs `__prompt_snapshots__/`) so that
 * `--update-snapshots` only refreshes the app prompts and never wipes
 * evaluation results. The same `--no-cache` flag bypasses both caches.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import type { ModelTarget, PromptRequest, ModelResponse } from '../providers/types.js';
import { isModelResponse, isModelTarget } from '../providers/guards.js';
import { isObject } from '../utils/guards.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EvalCacheType = 'judge' | 'embedding';

interface EvalCacheFile {
  hash: string;
  cacheType: EvalCacheType;
  target: ModelTarget;
  request: PromptRequest;
  response: ModelResponse;
}

function isEvalCacheFile(val: unknown): val is EvalCacheFile {
  return (
    isObject(val) &&
    typeof val['hash'] === 'string' &&
    (val['cacheType'] === 'judge' || val['cacheType'] === 'embedding') &&
    isModelTarget(val['target']) &&
    isObject(val['request']) &&
    isModelResponse(val['response'])
  );
}

// ---------------------------------------------------------------------------
// Flags (mirrors SnapshotFlags in snapshot-manager.ts)
// ---------------------------------------------------------------------------

interface EvalCacheFlags {
  noCache: boolean;
  updateSnapshots: boolean;
}

let evalCacheFlags: EvalCacheFlags = { noCache: false, updateSnapshots: false };

/**
 * Set cache flags for the eval cache.  Called by `setSnapshotFlags` so both
 * caches always honour the same CLI options (`--no-cache`, `--update-snapshots`).
 */
export function setEvalCacheFlags(flags: EvalCacheFlags): void {
  evalCacheFlags = flags;
}

// ---------------------------------------------------------------------------
// Paths & hashing
// ---------------------------------------------------------------------------

function getEvalCacheDir(): string {
  return path.join(process.cwd(), '__prompt_snapshots__', 'eval');
}

function generateEvalHash(
  cacheType: EvalCacheType,
  target: ModelTarget,
  request: PromptRequest,
): string {
  const payload = {
    cacheType,
    provider: target.provider,
    model: target.model,
    system: request.system ?? null,
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    temperature: request.temperature ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const EvalCacheManager = {
  /**
   * Returns the cached `ModelResponse` for an evaluator call, or `null` on a
   * miss. Respects `--no-cache` and `--update-snapshots` flags.
   */
  get(
    cacheType: EvalCacheType,
    target: ModelTarget,
    request: PromptRequest,
  ): ModelResponse | null {
    if (evalCacheFlags.noCache || evalCacheFlags.updateSnapshots) return null;

    const hash = generateEvalHash(cacheType, target, request);
    const filePath = path.join(getEvalCacheDir(), `${hash}.json`);

    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!isEvalCacheFile(parsed)) return null;

      return {
        ...parsed.response,
        metadata: { ...parsed.response.metadata, latencyMs: 0 },
      };
    } catch {
      return null;
    }
  },

  /**
   * Persists an evaluator response to the eval cache using an atomic
   * write-then-rename to avoid torn files under concurrent access.
   */
  save(
    cacheType: EvalCacheType,
    target: ModelTarget,
    request: PromptRequest,
    response: ModelResponse,
  ): void {
    if (evalCacheFlags.noCache) return;

    const cacheDir = getEvalCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });

    const hash = generateEvalHash(cacheType, target, request);
    const finalPath = path.join(cacheDir, `${hash}.json`);

    // Idempotency fast-path — skip the write if the entry already exists and
    // we are not in update mode.
    if (!evalCacheFlags.updateSnapshots && fs.existsSync(finalPath)) return;

    const entry: EvalCacheFile = { hash, cacheType, target, request, response };
    const content = JSON.stringify(entry, null, 2);

    const tmpPath = path.join(
      cacheDir,
      `.tmp-${hash}-${crypto.randomBytes(4).toString('hex')}.json`,
    );
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  },
};
