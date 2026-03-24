import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expect as promptExpect } from '../../../src/api/assertions.js';
import { executionContext } from '../../../src/core/context.js';
import type { LLMProvider, ModelResponse } from '../../../src/providers/types.js';
import { registerProvider, setupJudge } from '../../../src/api/setup.js';
import { checkStructuralEquivalence } from '../../../src/evaluators/structure.js';
import { makeDummyTest } from '../../shared/factories.js';

vi.mock('../../../src/cache/snapshot-manager.js', () => ({
  SnapshotManager: { get: vi.fn().mockReturnValue(null), save: vi.fn() },
}));
vi.mock('../../../src/cache/eval-cache.js', () => ({
  EvalCacheManager: { get: vi.fn().mockReturnValue(null), save: vi.fn() },
}));

function makeJudgeResponse(score: number, reasoning: string): ModelResponse {
  return {
    text: JSON.stringify({ score, reasoning }),
    rawResponse: {},
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    metadata: { latencyMs: 50, providerId: 'mock-new', model: 'judge-model' },
  };
}

const mockExecute = vi.fn<[string, Parameters<LLMProvider['execute']>[1]], Promise<ModelResponse>>();
registerProvider({ id: 'mock-new', execute: mockExecute });

beforeEach(() => {
  mockExecute.mockReset();
  setupJudge({ target: { provider: 'mock-new', model: 'judge-model' } });
});

describe('checkStructuralEquivalence', () => {
  it('passes when the text follows the expected structural pattern', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.92, 'Text has a clear intro, three bullet points, and a conclusion.'),
    );

    await expect(
      checkStructuralEquivalence(
        'Introduction.\n• Point 1\n• Point 2\n• Point 3\nConclusion.',
        'intro paragraph → 3 bullet points → conclusion',
      ),
    ).resolves.not.toThrow();
  });

  it('passes with a custom lower threshold', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.65, 'Mostly correct but conclusion is thin.'),
    );

    await expect(
      checkStructuralEquivalence(
        'Intro.\n• Point 1\n• Point 2\nEnd.',
        'intro → 2 bullet points → closing',
        { threshold: 0.6 },
      ),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when structural elements are missing', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.3, 'Text is a single paragraph with no list elements.'),
    );

    await expect(
      checkStructuralEquivalence(
        'Just a plain paragraph.',
        'greeting → numbered list of 3 items → call to action',
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws JudgeError when structural order does not match', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.4, 'Conclusion appears before the body; wrong order.'),
    );

    await expect(
      checkStructuralEquivalence(
        'Conclusion first. Then body.',
        'intro → body → conclusion',
        { threshold: 0.75 },
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('surfaces reasoning in the JudgeError message', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.2, 'Missing the required numbered list.'),
    );

    await expect(
      checkStructuralEquivalence('No list here.', 'numbered list of 5 items'),
    ).rejects.toThrow('Missing the required numbered list');
  });

  it('toBeStructurallyEquivalent assertion passes inside executionContext', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.88, 'Correct structure.'));

    const dummyTest = makeDummyTest('struct-pass');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Hi!\n1. Option A\n2. Option B\nLet me know!')
          .toBeStructurallyEquivalent('greeting → numbered options → closing question'),
      ),
    ).resolves.not.toThrow();
  });

  it('not.toBeStructurallyEquivalent passes when structure does not match', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.2, 'No structure detected.'));

    const dummyTest = makeDummyTest('struct-not');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Random unstructured text.')
          .not.toBeStructurallyEquivalent('intro → list → conclusion'),
      ),
    ).resolves.not.toThrow();
  });
});
