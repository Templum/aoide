import pricingData from './pricing.json' with { type: 'json' };
import type { ModelTarget, ModelResponse } from '../providers/types.js';
import { getCurrentTest } from '../core/context.js';
import { loadConfig } from '../utils/config.js';
import type { AoideConfig, PricingEntry } from '../utils/config.js';

let cachedConfig: AoideConfig | null = null;
let configLoadPromise: Promise<AoideConfig> | null = null;

// All writes to globalTelemetry and per-test telemetry are serialised through
// this promise chain so that concurrent awaits across the configLoadPromise
// boundary cannot produce a torn read-modify-write.
let writeQueue: Promise<void> = Promise.resolve();

export interface TelemetrySummary {
  appTokens: number;
  evalTokens: number;
  appCost: number;
  evalCost: number;
  cachedRequests: number;
}

const globalTelemetry: TelemetrySummary = {
  appTokens: 0,
  evalTokens: 0,
  appCost: 0,
  evalCost: 0,
  cachedRequests: 0,
};

function isPricingEntry(value: unknown): value is PricingEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['input'] === 'number' &&
    typeof (value as Record<string, unknown>)['output'] === 'number'
  );
}

function resolvePricing(
  target: ModelTarget,
  overrides: Record<string, PricingEntry> | undefined,
): PricingEntry {
  const key = `${target.provider}:${target.model}`;

  // Check exact override match
  if (overrides !== undefined) {
    const exact = overrides[key];
    if (exact !== undefined) return exact;

    // Check wildcard override (e.g. "local:*")
    const wildcardKey = `${target.provider}:*`;
    const wildcard = overrides[wildcardKey];
    if (wildcard !== undefined) return wildcard;
  }

  // Local providers are always free — no network cost
  if (target.provider === 'local' || target.provider.startsWith('local:')) return { input: 0, output: 0 };

  // Fall back to bundled pricing.json (costs are per 1,000,000 tokens)
  const models = pricingData.models as Record<string, unknown>;
  const entry = models[target.model];
  if (isPricingEntry(entry)) return entry;

  return { input: 0, output: 0 };
}

export const TelemetryTracker = {
  async record(
    target: ModelTarget,
    usage: ModelResponse['usage'],
    type: 'app' | 'eval',
    cached = false,
  ): Promise<void> {
    // Async config loading happens outside the write queue — it is safe to
    // await here because we have not yet touched any shared mutable state.
    if (cachedConfig === null) {
      if (configLoadPromise === null) {
        configLoadPromise = loadConfig().then(cfg => {
          cachedConfig = cfg;
          return cfg;
        });
      }
      await configLoadPromise;
    }
    const pricing = resolvePricing(target, cachedConfig!.pricingOverrides);

    // pricing.json stores cost per 1,000,000 tokens
    const inputCost = pricing.input / 1_000_000;
    const outputCost = pricing.output / 1_000_000;
    const cost = usage.promptTokens * inputCost + usage.completionTokens * outputCost;

    // Capture the test reference NOW, while still inside the AsyncLocalStorage
    // context of the calling test. The write queue runs in a detached chain
    // where the ALS context is no longer available.
    let currentTest: ReturnType<typeof getCurrentTest> | null = null;
    try { currentTest = getCurrentTest(); } catch { /* outside test context */ }

    // Serialise all mutations through the write queue to prevent concurrent
    // read-modify-write races on globalTelemetry across await boundaries.
    writeQueue = writeQueue.then(() => {
      if (type === 'app') {
        globalTelemetry.appTokens += usage.totalTokens;
        globalTelemetry.appCost += cost;
      } else {
        globalTelemetry.evalTokens += usage.totalTokens;
        globalTelemetry.evalCost += cost;
      }
      if (cached) globalTelemetry.cachedRequests += 1;

      if (currentTest !== null) {
        if (type === 'app') {
          currentTest.telemetry.appTokens += usage.totalTokens;
          currentTest.telemetry.appCost += cost;
        } else {
          currentTest.telemetry.evalTokens += usage.totalTokens;
          currentTest.telemetry.evalCost += cost;
        }
        if (cached) currentTest.telemetry.cachedRequests += 1;
      }
    });

    // Await the queue so callers can trust telemetry is committed on return.
    await writeQueue;
  },

  getSummary(): TelemetrySummary {
    return { ...globalTelemetry };
  },

  /** Reset global telemetry — used by the runner between test runs. */
  reset(): void {
    // Reset the write queue first so no stale pending writes execute after reset.
    writeQueue = Promise.resolve();
    globalTelemetry.appTokens = 0;
    globalTelemetry.evalTokens = 0;
    globalTelemetry.appCost = 0;
    globalTelemetry.evalCost = 0;
    globalTelemetry.cachedRequests = 0;
  },

  /** Pre-seed the config cache from an already-loaded config (called by CLI to avoid re-reading disk). */
  seedCache(config: AoideConfig): void {
    cachedConfig = config;
    configLoadPromise = Promise.resolve(config);
  },

  /** Clear the config cache — allows fresh config load on next record() call. */
  resetCache(): void {
    cachedConfig = null;
    configLoadPromise = null;
  },
};

/**
 * Synchronously computes the cost of a model response using the same pricing
 * logic as TelemetryTracker, but without async config loading.
 *
 * Pass `pricingOverrides` from your promptest config to respect custom pricing.
 * Local providers (provider === 'local' or starts with 'local:') always return 0
 * unless overridden.
 *
 * @returns Cost in USD.
 */
export function computeCost(
  target: ModelTarget,
  usage: ModelResponse['usage'],
  pricingOverrides?: Record<string, PricingEntry>,
): number {
  const pricing = resolvePricing(target, pricingOverrides);
  const inputCost = pricing.input / 1_000_000;
  const outputCost = pricing.output / 1_000_000;
  return usage.promptTokens * inputCost + usage.completionTokens * outputCost;
}
