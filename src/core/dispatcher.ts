import type { ModelTarget, PromptRequest, ModelResponse } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { getProviderConcurrency } from '../api/setup.js';
import { withRetry } from '../utils/retry.js';

let globalConcurrencyLimit: number | undefined;
let globalMaxRetries: number | undefined;
let globalBackoffMs: number | undefined;

/** Configure retry behaviour — typically called from the CLI after loading config. */
export function setRetryPolicy(maxRetries: number, backoffMs: number): void {
  globalMaxRetries = maxRetries;
  globalBackoffMs = backoffMs;
}

/**
 * Set a global concurrency cap that applies to all providers unless they have
 * a provider-specific limit set via setProviderConcurrency().
 * Primarily used to honour the --max-workers CLI flag.
 */
export function setGlobalConcurrency(limit: number): void {
  globalConcurrencyLimit = limit;
}

class Dispatcher {
  private readonly queues = new Map<string, Array<() => Promise<void>>>();
  private readonly active = new Map<string, number>();

  dispatch(target: ModelTarget, request: PromptRequest): Promise<ModelResponse> {
    const providerId = target.provider;

    // Validate the provider exists immediately so the error is thrown at the
    // call site with a useful stack trace, not buried in a queue callback.
    getProvider(providerId);

    return new Promise<ModelResponse>((resolve, reject) => {
      const task = async (): Promise<void> => {
        try {
          const response = await withRetry(
            () => getProvider(providerId).execute(target.model, request),
            globalMaxRetries ?? 3,
            globalBackoffMs ?? 100,
          );
          resolve(response);
        } catch (err) {
          reject(err);
        }
      };

      if (!this.queues.has(providerId)) {
        this.queues.set(providerId, []);
        this.active.set(providerId, 0);
      }
      this.queues.get(providerId)!.push(task);
      this.processQueue(providerId);
    });
  }

  private processQueue(providerId: string): void {
    const limit = this.getConcurrencyLimit(providerId);
    const queue = this.queues.get(providerId);
    if (!queue) return;

    // Drain as many slots as the concurrency limit allows in one synchronous
    // pass. Because JS is single-threaded within a microtask, incrementing
    // `active` inside the while-loop is safe — no other code can interleave
    // between the check and the increment.
    while ((this.active.get(providerId) ?? 0) < limit && queue.length > 0) {
      const task = queue.shift()!;
      this.active.set(providerId, (this.active.get(providerId) ?? 0) + 1);

      task().finally(() => {
        this.active.set(providerId, Math.max(0, (this.active.get(providerId) ?? 1) - 1));
        this.processQueue(providerId);
      });
    }
  }

  private getConcurrencyLimit(providerId: string): number {
    // Provider-specific limit takes highest precedence.
    const configured = getProviderConcurrency(providerId);
    if (configured !== undefined) return configured;
    // Local providers are always capped at 1 to avoid overwhelming host resources.
    if (providerId.startsWith('local:')) return 1;
    // Global CLI cap (--max-workers) applies to remote providers.
    if (globalConcurrencyLimit !== undefined) return globalConcurrencyLimit;
    return 5;
  }
}

export const dispatcher = new Dispatcher();
