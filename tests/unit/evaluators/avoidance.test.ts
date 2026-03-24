import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expect as promptExpect } from '../../../src/api/assertions.js';
import { executionContext } from '../../../src/core/context.js';
import type { LLMProvider, ModelResponse } from '../../../src/providers/types.js';
import { registerProvider, setupJudge } from '../../../src/api/setup.js';
import { checkAvoidTopics } from '../../../src/evaluators/avoidance.js';
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

describe('checkAvoidTopics', () => {
  it('passes when the text avoids all listed topics', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.97, 'Text discusses weather; no mention of politics or religion.'),
    );

    await expect(
      checkAvoidTopics(
        'The weather today is sunny with a light breeze.',
        ['politics', 'religion'],
      ),
    ).resolves.not.toThrow();
  });

  it('passes with a custom lower threshold', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.75, 'Text largely avoids the topic but has an indirect reference.'),
    );

    await expect(
      checkAvoidTopics(
        'Some people believe strongly in different value systems.',
        ['religion'],
        { threshold: 0.7 },
      ),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when the text directly discusses a forbidden topic', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.1, 'Text extensively discusses the election and political parties.'),
    );

    await expect(
      checkAvoidTopics(
        'The election results show a clear victory for the incumbent party.',
        ['politics', 'elections'],
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws JudgeError when the text indirectly references a forbidden topic', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.35, 'Text indirectly discusses faith and religious belief systems.'),
    );

    await expect(
      checkAvoidTopics(
        'Many people base their decisions on deeply held faith and spiritual beliefs.',
        ['religion'],
        { threshold: 0.8 },
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws TypeError when the topics array is empty', async () => {
    await expect(
      checkAvoidTopics('Some text.', []),
    ).rejects.toThrow('topics array must contain at least one topic');
  });

  it('sorts topics before embedding them in the judge prompt (deterministic caching)', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.95, 'All topics avoided.'));

    // Call with topics in reverse-alphabetical order
    await checkAvoidTopics('Clean response.', ['zebra', 'mango', 'apple']);

    const calledWith = mockExecute.mock.calls[0][1];
    const promptContent = (calledWith.messages[0].content as string);

    // Sorted order should appear in the prompt
    expect(promptContent.indexOf('apple')).toBeLessThan(promptContent.indexOf('mango'));
    expect(promptContent.indexOf('mango')).toBeLessThan(promptContent.indexOf('zebra'));
  });

  it('surfaces reasoning in the JudgeError message', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.05, 'Text is entirely about competitor pricing strategy.'),
    );

    await expect(
      checkAvoidTopics('Our competitor charges less per seat.', ['competitor pricing']),
    ).rejects.toThrow('competitor pricing strategy');
  });

  it('toAvoidTopics assertion passes inside executionContext', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.93, 'Clean.'));

    const dummyTest = makeDummyTest('avoid-pass');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('The product ships in 3–5 business days.')
          .toAvoidTopics(['competitor names', 'pricing']),
      ),
    ).resolves.not.toThrow();
  });

  it('not.toAvoidTopics passes when the text does discuss the topic', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.05, 'Text is about politics.'));

    const dummyTest = makeDummyTest('avoid-not');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('This election is historic.')
          .not.toAvoidTopics(['politics'], { threshold: 0.8 }),
      ),
    ).resolves.not.toThrow();
  });
});
