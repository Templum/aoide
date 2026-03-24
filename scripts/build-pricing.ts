/**
 * scripts/build-pricing.ts
 *
 * Fetches current LLM model pricing from two public, no-auth data sources
 * and writes the merged result to src/telemetry/pricing.json.
 *
 * Sources (in priority order):
 *   1. LiteLLM  — https://github.com/BerriAI/litellm
 *      Raw JSON: https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 *      2500+ models, prices in USD per token. The canonical source.
 *
 *   2. llm-prices.com — https://www.llm-prices.com/current-v1.json
 *      100+ models, prices in USD per 1M tokens. Covers newer / marketing-named
 *      models that LiteLLM may not yet have under the plain API ID.
 *
 * Usage:
 *   npx tsx scripts/build-pricing.ts            # fetch and write
 *   npx tsx scripts/build-pricing.ts --dry-run  # print result, don't write
 *   npx tsx scripts/build-pricing.ts --verbose  # show every accepted/rejected model
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../src/telemetry/pricing.json');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const LLMPRICES_URL = 'https://www.llm-prices.com/current-v1.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PricingEntry {
  input: number;
  output: number;
}

interface PricingData {
  updatedAt: string;
  sources: string[];
  models: Record<string, PricingEntry>;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'promptest-build-pricing/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Source 1: LiteLLM
//
// Format: flat object keyed by model ID.
//   { "gpt-4o": { input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5, litellm_provider: "openai", ... }, ... }
//
// We only include models with:
//   - No "/" in the key (excludes provider-prefixed routing keys like "deepinfra/google/gemini-2.5-pro")
//   - No "." before "-" in a prefix (excludes Bedrock-style "anthropic.claude-*", "amazon.nova-*")
//   - Both input and output cost present and > 0
//   - Not the special "sample_spec" meta entry
// ---------------------------------------------------------------------------

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  litellm_provider?: string;
}

function isLiteLLMEntry(v: unknown): v is LiteLLMEntry {
  return typeof v === 'object' && v !== null;
}

function isDirectModelId(key: string): boolean {
  if (key === 'sample_spec') return false;
  if (key.includes('/')) return false;
  // Exclude Bedrock-style "anthropic.claude-*", "amazon.nova-*", "ai21.j2-*", etc.
  if (/^[a-z0-9]+\.[a-z]/.test(key)) return false;
  // Exclude image / dimension / resolution keys ("1024-x-1024/...")
  if (/^\d/.test(key)) return false;
  return true;
}

async function fetchLiteLLM(): Promise<Record<string, PricingEntry>> {
  console.log(`\nFetching LiteLLM pricing database...`);
  const raw = await fetchJson(LITELLM_URL);
  if (typeof raw !== 'object' || raw === null) throw new Error('LiteLLM: unexpected response');

  const result: Record<string, PricingEntry> = {};
  let accepted = 0;
  let rejected = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDirectModelId(key)) {
      rejected++;
      if (VERBOSE) console.log(`  [skip] ${key}`);
      continue;
    }
    if (!isLiteLLMEntry(value)) { rejected++; continue; }

    const inputPerToken = value.input_cost_per_token;
    const outputPerToken = value.output_cost_per_token;

    if (
      typeof inputPerToken !== 'number' || inputPerToken <= 0 ||
      typeof outputPerToken !== 'number' || outputPerToken <= 0
    ) {
      rejected++;
      if (VERBOSE) console.log(`  [no-price] ${key}`);
      continue;
    }

    // Convert per-token → per 1M tokens (our storage format)
    result[key] = {
      input: parseFloat((inputPerToken * 1_000_000).toFixed(6)),
      output: parseFloat((outputPerToken * 1_000_000).toFixed(6)),
    };
    accepted++;
    if (VERBOSE) console.log(`  [ok] ${key} => $${result[key].input}/$${result[key].output}`);
  }

  console.log(`  Accepted ${accepted} models, skipped ${rejected} (provider-prefixed / no price)`);
  return result;
}

// ---------------------------------------------------------------------------
// Source 2: llm-prices.com
//
// Format: { updated_at: "...", prices: [{ id, vendor, name, input, output, input_cached }] }
// Prices are already in USD per 1M tokens.
//
// Their IDs tend to be marketing-name-style ("claude-3.5-sonnet", "gpt-4o") or
// versioned dates ("gemini-2.5-pro-preview-03-25"). We keep their IDs as-is so
// users can reference them. Where a model already exists in LiteLLM under the
// same key, LiteLLM wins (it uses the canonical API model ID).
// ---------------------------------------------------------------------------

interface LLMPricesEntry {
  id: string;
  vendor: string;
  name: string;
  input: number;
  output: number;
  input_cached?: number | null;
}

interface LLMPricesResponse {
  updated_at: string;
  prices: LLMPricesEntry[];
}

function isLLMPricesResponse(v: unknown): v is LLMPricesResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as LLMPricesResponse).prices)
  );
}

async function fetchLLMPrices(): Promise<Record<string, PricingEntry>> {
  console.log(`\nFetching llm-prices.com database...`);
  const raw = await fetchJson(LLMPRICES_URL);
  if (!isLLMPricesResponse(raw)) throw new Error('llm-prices.com: unexpected response shape');

  const result: Record<string, PricingEntry> = {};
  let accepted = 0;

  for (const entry of raw.prices) {
    if (
      typeof entry.id !== 'string' ||
      typeof entry.input !== 'number' || entry.input <= 0 ||
      typeof entry.output !== 'number' || entry.output <= 0
    ) {
      if (VERBOSE) console.log(`  [skip] ${entry.id} — missing/zero price`);
      continue;
    }
    result[entry.id] = {
      input: parseFloat(entry.input.toFixed(6)),
      output: parseFloat(entry.output.toFixed(6)),
    };
    accepted++;
    if (VERBOSE) console.log(`  [ok] ${entry.id} (${entry.vendor})`);
  }

  console.log(`  Accepted ${accepted} models`);
  return result;
}

// ---------------------------------------------------------------------------
// Hardcoded overrides for retired / aliased model IDs that live sources no
// longer track, but which remain valid in provider APIs. Prices are USD/1M tokens.
// ---------------------------------------------------------------------------

const RETIRED_ALIASES: Record<string, PricingEntry> = {
  // Anthropic — versioned IDs retired from LiteLLM tracking but still callable
  'claude-3-5-sonnet-20241022':  { input: 3.0,  output: 15.0 },
  'claude-3-5-haiku-20241022':   { input: 0.8,  output: 4.0  },
  'claude-3-sonnet-20240229':    { input: 3.0,  output: 15.0 },
  'claude-3-5-sonnet-20240620':  { input: 3.0,  output: 15.0 },
};

// ---------------------------------------------------------------------------
// Merge strategy
// Priority: LiteLLM > llm-prices.com > retired aliases
// (LiteLLM uses canonical API IDs; llm-prices supplements with newer/alias IDs)
// ---------------------------------------------------------------------------

function merge(
  ...sources: Array<Record<string, PricingEntry>>
): Record<string, PricingEntry> {
  // First source wins for any given key
  const result: Record<string, PricingEntry> = {};
  for (const source of sources.reverse()) {
    // Apply in reverse so first source ends up winning
    Object.assign(result, source);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Diff reporter
// ---------------------------------------------------------------------------

function reportDiff(
  previous: Record<string, PricingEntry>,
  next: Record<string, PricingEntry>,
): void {
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of allKeys) {
    const prev = previous[key];
    const curr = next[key];
    if (!prev) {
      added.push(`  + ${key}  ($${curr.input}/$${curr.output})`);
    } else if (!curr) {
      removed.push(`  - ${key}`);
    } else if (
      Math.abs(prev.input - curr.input) > 1e-9 ||
      Math.abs(prev.output - curr.output) > 1e-9
    ) {
      changed.push(
        `  ~ ${key}  input: $${prev.input} → $${curr.input}  output: $${prev.output} → $${curr.output}`,
      );
    }
  }

  if (added.length > 0) console.log(`\nAdded (${added.length}):\n${added.join('\n')}`);
  if (removed.length > 0) console.log(`\nRemoved (${removed.length}):\n${removed.join('\n')}`);
  if (changed.length > 0) console.log(`\nPrice changes (${changed.length}):\n${changed.join('\n')}`);
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log('\nNo pricing changes detected.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== build-pricing ===');
  if (DRY_RUN) console.log('(dry-run mode — will not write file)');

  // Load existing data for diff reporting
  let existingModels: Record<string, PricingEntry> = {};
  try {
    const raw = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as PricingData;
    existingModels = raw.models ?? {};
    console.log(`\nLoaded existing pricing.json (${Object.keys(existingModels).length} models)`);
  } catch {
    console.log('\nNo existing pricing.json — will create fresh.');
  }

  // Fetch from both sources in parallel
  const [litellm, llmprices] = await Promise.allSettled([
    fetchLiteLLM(),
    fetchLLMPrices(),
  ]);

  const sources: string[] = [];

  const litellmData =
    litellm.status === 'fulfilled'
      ? litellm.value
      : (console.error(`\n[error] LiteLLM fetch failed: ${(litellm as PromiseRejectedResult).reason}`), {});

  const llmpricesData =
    llmprices.status === 'fulfilled'
      ? llmprices.value
      : (console.error(`\n[error] llm-prices.com fetch failed: ${(llmprices as PromiseRejectedResult).reason}`), {});

  if (litellm.status === 'fulfilled') sources.push(LITELLM_URL);
  if (llmprices.status === 'fulfilled') sources.push(LLMPRICES_URL);

  if (sources.length === 0) {
    console.error('\nAll sources failed — aborting. Existing file unchanged.');
    process.exit(1);
  }

  // Merge: LiteLLM wins over llm-prices.com; both win over retired aliases
  const merged = merge(RETIRED_ALIASES, llmpricesData, litellmData);

  // Sort keys alphabetically for stable diffs and readable JSON
  const models = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );

  console.log(`\n--- Diff vs current file ---`);
  reportDiff(existingModels, models);

  const totalModels = Object.keys(models).length;
  console.log(`\nTotal models in new file: ${totalModels}`);

  const output: PricingData = {
    updatedAt: new Date().toISOString(),
    sources,
    models,
  };

  if (DRY_RUN) {
    console.log('\n--- Output (dry-run) ---');
    console.log(JSON.stringify(output, null, 2));
  } else {
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.log(`\nWrote ${OUTPUT_PATH}  (${totalModels} models)`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
