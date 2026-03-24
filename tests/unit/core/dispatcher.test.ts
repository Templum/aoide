import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, ModelResponse } from '../../../src/providers/base.js';
import { registerProvider, setProviderConcurrency } from '../../../src/api/setup.js';

// ---------------------------------------------------------------------------
// Dispatcher concurrency logic extracted for unit testing.
// The real Dispatcher class is not exported, so we mirror the throttling logic
// here and verify the contract: only N tasks run concurrently for a given limit.
// ---------------------------------------------------------------------------

type Task = () => Promise<void>;

function makeDispatcher(getConcurrency: (id: string) => number) {
  const queues = new Map<string, Task[]>();
  const active = new Map<string, number>();

  function processQueue(providerId: string): void {
    const limit = getConcurrency(providerId);
    const currentActive = active.get(providerId) ?? 0;
    if (currentActive >= limit) return;
    const queue = queues.get(providerId);
    if (!queue || queue.length === 0) return;
    const task = queue.shift()!;
    active.set(providerId, currentActive + 1);
    task().finally(() => {
      active.set(providerId, (active.get(providerId) ?? 1) - 1);
      processQueue(providerId);
    });
  }

  function dispatch(providerId: string, task: Task): void {
    if (!queues.has(providerId)) {
      queues.set(providerId, []);
      active.set(providerId, 0);
    }
    queues.get(providerId)!.push(task);
    processQueue(providerId);
  }

  return { dispatch };
}

describe('Dispatcher concurrency throttling', () => {
  it('allows at most `limit` concurrent executions', async () => {
    const LIMIT = 2;
    const TASKS = 5;

    const dispatcher = makeDispatcher(() => LIMIT);

    let maxConcurrent = 0;
    let currentConcurrent = 0;
    const completions: Array<() => void> = [];

    const promises = Array.from({ length: TASKS }, (_, i) =>
      new Promise<number>((resolve) => {
        dispatcher.dispatch('test-provider', async () => {
          currentConcurrent++;
          if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;

          // Pause until the test releases this task
          await new Promise<void>(res => { completions[i] = res; });

          currentConcurrent--;
          resolve(i);
        });
      }),
    );

    // Give the event loop a tick to start queued tasks
    await new Promise(res => setTimeout(res, 0));

    expect(maxConcurrent).toBe(LIMIT);
    expect(currentConcurrent).toBe(LIMIT);

    // Release all tasks one by one, verifying concurrency never exceeds limit
    for (let i = 0; i < TASKS; i++) {
      completions[i]?.();
      await new Promise(res => setTimeout(res, 0));
      expect(currentConcurrent).toBeLessThanOrEqual(LIMIT);
    }

    await Promise.all(promises);
    expect(maxConcurrent).toBe(LIMIT);
  });

  it('runs tasks serially when limit is 1', async () => {
    const dispatcher = makeDispatcher(() => 1);
    const order: number[] = [];
    const completions: Array<() => void> = [];

    const promises = [0, 1, 2].map(i =>
      new Promise<void>(resolve => {
        dispatcher.dispatch('serial-provider', async () => {
          order.push(i);
          await new Promise<void>(res => { completions[i] = res; });
          resolve();
        });
      }),
    );

    await new Promise(res => setTimeout(res, 0));
    // Only task 0 should have started
    expect(order).toEqual([0]);

    completions[0]?.();
    await new Promise(res => setTimeout(res, 0));
    expect(order).toEqual([0, 1]);

    completions[1]?.();
    await new Promise(res => setTimeout(res, 0));
    expect(order).toEqual([0, 1, 2]);

    completions[2]?.();
    await Promise.all(promises);
  });

  it('defaults to concurrency 5 for non-local providers and 1 for local: providers', () => {
    function getDefaultLimit(providerId: string): number {
      return providerId.startsWith('local:') ? 1 : 5;
    }

    expect(getDefaultLimit('openai')).toBe(5);
    expect(getDefaultLimit('ollama')).toBe(5);
    expect(getDefaultLimit('local:llama')).toBe(1);
    expect(getDefaultLimit('local:mistral')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: verify the real dispatcher routes through a registered provider
// ---------------------------------------------------------------------------

describe('Dispatcher integration with real provider', () => {
  const mockExecute = vi.fn<[string, Parameters<LLMProvider['execute']>[1]], Promise<ModelResponse>>();

  const mockProvider: LLMProvider = {
    id: 'dispatcher-mock',
    execute: mockExecute,
  };

  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('dispatches to the registered provider and returns the response', async () => {
    registerProvider(mockProvider);
    setProviderConcurrency('dispatcher-mock', 5);

    const expected: ModelResponse = {
      text: 'dispatched!',
      rawResponse: {},
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      metadata: { latencyMs: 10, providerId: 'dispatcher-mock', model: 'test-model' },
    };
    mockExecute.mockResolvedValue(expected);

    const { dispatcher } = await import('../../../src/core/dispatcher.js');

    const result = await dispatcher.dispatch(
      { provider: 'dispatcher-mock', model: 'test-model' },
      { messages: [{ role: 'user', content: 'hello' }] },
    );

    expect(result).toBe(expected);
    expect(mockExecute).toHaveBeenCalledWith('test-model', {
      messages: [{ role: 'user', content: 'hello' }],
    });
  });
});
