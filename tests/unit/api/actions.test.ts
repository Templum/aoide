import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, ModelResponse } from '../../../src/providers/types.js';
import { executionContext } from '../../../src/core/context.js';
import { registerProvider } from '../../../src/api/setup.js';
import { runPrompt } from '../../../src/api/actions.js';
import { makeResponse, makeDummyTest } from '../../shared/factories.js';

vi.mock('../../../src/cache/snapshot-manager.js', () => ({
  SnapshotManager: {
    get: vi.fn().mockReturnValue(null),
    save: vi.fn(),
  },
}));

vi.mock('../../../src/cache/eval-cache.js', () => ({
  EvalCacheManager: {
    get: vi.fn().mockReturnValue(null),
    save: vi.fn(),
  },
}));

const mockExecute = vi.fn<[string, Parameters<LLMProvider['execute']>[1]], Promise<ModelResponse>>();

const mockProvider: LLMProvider = {
  id: 'mock',
  execute: mockExecute,
};

registerProvider(mockProvider);

beforeEach(() => {
  mockExecute.mockReset();
});

describe('actions', () => {
  it('routes runPrompt to the registered provider and returns its response', async () => {
    const expected = makeResponse('hello from mock');
    mockExecute.mockResolvedValue(expected);

    const dummyTest = makeDummyTest();
    const result = await executionContext.run(dummyTest, () =>
      runPrompt({ provider: 'mock', model: 'mock-model' }, {
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
    );

    expect(result).toBe(expected);
    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledWith('mock-model', {
      messages: [{ role: 'user', content: 'Say hello' }],
    });
  });

  it('throws when called outside an executionContext (outside an `it` block)', async () => {
    mockExecute.mockResolvedValue(makeResponse('hi'));

    await expect(
      runPrompt({ provider: 'mock', model: 'mock-model' }, {
        messages: [{ role: 'user', content: 'ping' }],
      }),
    ).rejects.toThrow('getCurrentTest() called outside of a running test');
  });
});
