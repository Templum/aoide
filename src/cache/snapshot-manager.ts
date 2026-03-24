import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ModelTarget, PromptRequest, ModelResponse } from '../providers/types.js';
import { isModelResponse, isModelTarget } from '../providers/guards.js';
import { isObject } from '../utils/guards.js';
import { generatePromptHash } from './hash.js';
import { setEvalCacheFlags } from './eval-cache.js';

interface SnapshotFile {
  hash: string;
  target: ModelTarget;
  request: PromptRequest;
  response: ModelResponse;
}

function isSnapshotFile(val: unknown): val is SnapshotFile {
  return (
    isObject(val) &&
    typeof val['hash'] === 'string' &&
    isModelTarget(val['target']) &&
    isObject(val['request']) &&
    isModelResponse(val['response'])
  );
}

interface SnapshotFlags {
  noCache: boolean;
  updateSnapshots: boolean;
}

let snapshotFlags: SnapshotFlags = { noCache: false, updateSnapshots: false };

export function setSnapshotFlags(flags: SnapshotFlags): void {
  snapshotFlags = flags;
  // Keep the eval cache in sync with the same --no-cache / --update-snapshots
  // flags so both caches honour the same CLI options.
  setEvalCacheFlags(flags);
}

function getSnapshotDir(): string {
  return path.join(process.cwd(), '__prompt_snapshots__');
}

export const SnapshotManager = {
  get(target: ModelTarget, request: PromptRequest): ModelResponse | null {
    if (snapshotFlags.updateSnapshots || snapshotFlags.noCache) {
      return null;
    }

    const hash = generatePromptHash(target, request);
    const filePath = path.join(getSnapshotDir(), `${hash}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (!isSnapshotFile(parsed)) {
        return null;
      }

      const response: ModelResponse = {
        ...parsed.response,
        metadata: {
          ...parsed.response.metadata,
          latencyMs: 0,
        },
      };

      return response;
    } catch (err) {
      console.warn('[aoide] Failed to read snapshot cache:', (err as Error).message);
      return null;
    }
  },

  save(target: ModelTarget, request: PromptRequest, response: ModelResponse): void {
    if (snapshotFlags.noCache) {
      return;
    }

    const snapshotDir = getSnapshotDir();
    fs.mkdirSync(snapshotDir, { recursive: true });

    const hash = generatePromptHash(target, request);
    const finalPath = path.join(snapshotDir, `${hash}.json`);

    // Idempotency fast-path: skip the write if the snapshot already exists and
    // we are not in update mode (the common case on re-runs).
    if (!snapshotFlags.updateSnapshots && fs.existsSync(finalPath)) {
      return;
    }

    const snapshot: SnapshotFile = { hash, target, request, response };
    const content = JSON.stringify(snapshot, null, 2);

    // Write to a per-hash temp file in the same directory, then rename
    // atomically. This prevents concurrent tests with the same prompt hash
    // from producing a torn write, and is crash-safe on POSIX systems.
    const tmpPath = path.join(
      snapshotDir,
      `.tmp-${hash}-${crypto.randomBytes(4).toString('hex')}.json`,
    );
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      // Clean up the orphaned temp file if the rename failed.
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  },
};
