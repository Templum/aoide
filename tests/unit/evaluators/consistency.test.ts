import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expect as promptExpect } from '../../../src/api/assertions.js';
import { executionContext } from '../../../src/core/context.js';
import type { LLMProvider, ModelResponse } from '../../../src/providers/types.js';
import { registerProvider, setupJudge } from '../../../src/api/setup.js';
import { checkFactualConsistency, checkMatchPersona, checkConsistentWith } from '../../../src/evaluators/consistency.js';
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

function makeModelResponse(text: string): ModelResponse {
  return {
    text,
    rawResponse: {},
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    metadata: { latencyMs: 30, providerId: 'mock-new', model: 'test-model' },
  };
}

const mockExecute = vi.fn<[string, Parameters<LLMProvider['execute']>[1]], Promise<ModelResponse>>();
registerProvider({ id: 'mock-new', execute: mockExecute });

beforeEach(() => {
  mockExecute.mockReset();
  setupJudge({ target: { provider: 'mock-new', model: 'judge-model' } });
});

describe('checkFactualConsistency', () => {
  it('passes when the evaluated text is fully faithful to the reference', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.95, 'No contradictions. All claims are supported by the reference.'),
    );

    await expect(
      checkFactualConsistency(
        'Paris is the capital of France and is located in western Europe.',
        'France is a country in western Europe. Its capital city is Paris.',
      ),
    ).resolves.not.toThrow();
  });

  it('passes with a custom lower threshold when score meets it', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.72, 'Mostly accurate but one minor unsupported detail.'),
    );

    await expect(
      checkFactualConsistency(
        'The Eiffel Tower is in Paris, the most visited city on Earth.',
        'The Eiffel Tower is located in Paris, France.',
        { threshold: 0.7 },
      ),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when the text directly contradicts the reference', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.15, 'Text claims Berlin is the capital, but reference states Paris.'),
    );

    await expect(
      checkFactualConsistency(
        'Berlin is the capital of France.',
        'France is a country in western Europe. Its capital city is Paris.',
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws JudgeError when the text hallucinates facts not in the reference', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.3, 'Text invents a founding date not mentioned in the reference.'),
    );

    await expect(
      checkFactualConsistency(
        'The company was founded in 1842 and has over 10,000 employees.',
        'The company is a software business headquartered in San Francisco.',
        { threshold: 0.8 },
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('surfaces reasoning in the JudgeError message', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.1, 'Major contradiction: text reverses the reference conclusion.'),
    );

    await expect(
      checkFactualConsistency('Wrong claim.', 'Reference text.'),
    ).rejects.toThrow('Major contradiction');
  });

  it('respects judgeOverride — routes to the specified model', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.9, 'Consistent.'),
    );

    await checkFactualConsistency('Good summary.', 'Source doc.', {
      judgeOverride: { provider: 'mock-new', model: 'override-judge' },
    });

    expect(mockExecute).toHaveBeenCalledWith('override-judge', expect.anything());
  });

  it('toBeFactuallyConsistent assertion passes inside executionContext', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.9, 'Faithful summary.'));

    const dummyTest = makeDummyTest('factual-pass');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Summary: Paris is in France.')
          .toBeFactuallyConsistent('Paris is the capital of France.', { threshold: 0.8 }),
      ),
    ).resolves.not.toThrow();
  });

  it('toBeFactuallyConsistent assertion fails inside executionContext when score is low', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.2, 'Contradicts reference.'));

    const dummyTest = makeDummyTest('factual-fail');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('London is the capital of France.')
          .toBeFactuallyConsistent('Paris is the capital of France.'),
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('not.toBeFactuallyConsistent passes when the text is intentionally unfaithful', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.1, 'Major contradictions.'));

    const dummyTest = makeDummyTest('factual-not');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Totally wrong facts.')
          .not.toBeFactuallyConsistent('Correct reference.', { threshold: 0.8 }),
      ),
    ).resolves.not.toThrow();
  });

  it('accepts a ModelResponse as actual value', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.88, 'Accurate.'));

    const dummyTest = makeDummyTest('factual-modelresponse');
    const modelResponse = makeModelResponse('Paris is in France.');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect(modelResponse)
          .toBeFactuallyConsistent('France is in Europe and its capital is Paris.'),
      ),
    ).resolves.not.toThrow();
  });
});

describe('checkMatchPersona', () => {
  it('passes when the text matches the described persona', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.91, 'Text is direct and uses bullet points — matches the engineer persona.'),
    );

    await expect(
      checkMatchPersona(
        '• Fix the null-pointer in parser.ts\n• Add regression test\n• Deploy to staging',
        'a senior software engineer who is direct and prefers bullet points',
      ),
    ).resolves.not.toThrow();
  });

  it('passes with a custom lower threshold', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.62, 'Mostly direct but slightly verbose in one sentence.'),
    );

    await expect(
      checkMatchPersona(
        'We should update the config. I think this approach is probably fine.',
        'a direct engineer',
        { threshold: 0.6 },
      ),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when the persona does not match', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.15, 'Text is overly formal and verbose; inconsistent with a direct engineer.'),
    );

    await expect(
      checkMatchPersona(
        'I humbly request that you consider the following technical proposal at your earliest convenience.',
        'a senior software engineer who is direct and prefers bullet points',
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws JudgeError for a wrong emotional register', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.2, 'Text is cold and dismissive; inconsistent with a warm customer service persona.'),
    );

    await expect(
      checkMatchPersona(
        'Your request is noted.',
        'a friendly customer service agent who acknowledges feelings and uses the customer name',
        { threshold: 0.7 },
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('surfaces reasoning in the JudgeError message', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.1, 'Language is far too casual for the stated professional persona.'),
    );

    await expect(
      checkMatchPersona('lol yeah whatever', 'a formal executive assistant'),
    ).rejects.toThrow('too casual');
  });

  it('respects judgeOverride', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.85, 'Matches.'));

    await checkMatchPersona('Good text.', 'direct engineer', {
      judgeOverride: { provider: 'mock-new', model: 'override-persona-judge' },
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'override-persona-judge',
      expect.anything(),
    );
  });

  it('toMatchPersona assertion passes inside executionContext', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.88, 'Matches persona.'));

    const dummyTest = makeDummyTest('persona-pass');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('• Ship it\n• Write tests first')
          .toMatchPersona('an engineer who prefers bullet points'),
      ),
    ).resolves.not.toThrow();
  });

  it('not.toMatchPersona passes when the text clashes with the persona', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.1, 'Mismatched persona.'));

    const dummyTest = makeDummyTest('persona-not');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('I respectfully submit this formal memorandum.')
          .not.toMatchPersona('casual slang-speaking teenager'),
      ),
    ).resolves.not.toThrow();
  });

  it('accepts a ModelResponse as actual value', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.87, 'Good fit.'));

    const dummyTest = makeDummyTest('persona-modelresponse');
    const modelResponse = makeModelResponse('• Fix now\n• Deploy ASAP');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect(modelResponse)
          .toMatchPersona('a concise, action-oriented engineer'),
      ),
    ).resolves.not.toThrow();
  });
});

describe('checkConsistentWith', () => {
  it('passes when the new response is coherent with the prior response', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.93, 'New response builds on prior; no contradictions.'),
    );

    await expect(
      checkConsistentWith(
        'Approach A is the best long-term strategy.',
        'Quick short-term fixes are not sustainable.',
      ),
    ).resolves.not.toThrow();
  });

  it('passes when the new response adds nuance without contradicting', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.88, 'Elaboration is consistent; prior position is preserved.'),
    );

    await expect(
      checkConsistentWith(
        'Use database X. It is best for write-heavy workloads specifically.',
        'Database X is the right choice for this project.',
      ),
    ).resolves.not.toThrow();
  });

  it('passes with a custom lower threshold', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.72, 'Minor tension but no outright contradiction.'),
    );

    await expect(
      checkConsistentWith(
        'Use database X, though Y is also acceptable.',
        'Database X is the right choice.',
        { threshold: 0.7 },
      ),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when the new response directly contradicts the prior', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.05, 'Direct contradiction: now recommends short-term fixes after prior said they are not sustainable.'),
    );

    await expect(
      checkConsistentWith(
        'Use quick short-term fixes — they are the best option.',
        'Quick short-term fixes are not sustainable.',
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('throws JudgeError when a position is reversed', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.1, 'Reversal detected: prior recommended X, new response recommends against X.'),
    );

    await expect(
      checkConsistentWith(
        'Do not use database X for this project.',
        'Database X is the right choice for this project.',
        { threshold: 0.8 },
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('surfaces reasoning in the JudgeError message', async () => {
    mockExecute.mockResolvedValue(
      makeJudgeResponse(0.08, 'Irreconcilable positions on the core architecture decision.'),
    );

    await expect(
      checkConsistentWith('Use microservices.', 'Use a monolith.'),
    ).rejects.toThrow('core architecture decision');
  });

  it('accepts a ModelResponse as priorResponse parameter', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.9, 'Consistent.'));

    const priorModelResponse = makeModelResponse('Use database X for scalability.');

    await expect(
      checkConsistentWith(
        'Database X is the right call here.',
        priorModelResponse.text,
      ),
    ).resolves.not.toThrow();
  });

  it('respects judgeOverride', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.85, 'Consistent.'));

    await checkConsistentWith('Follow-up text.', 'Prior text.', {
      judgeOverride: { provider: 'mock-new', model: 'override-consistency-judge' },
    });

    expect(mockExecute).toHaveBeenCalledWith(
      'override-consistency-judge',
      expect.anything(),
    );
  });

  it('toBeConsistentWith assertion passes inside executionContext with string prior', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.91, 'No contradiction.'));

    const dummyTest = makeDummyTest('consistent-pass-string');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('We should adopt approach A for the long term.')
          .toBeConsistentWith('Short-term hacks are problematic.'),
      ),
    ).resolves.not.toThrow();
  });

  it('toBeConsistentWith assertion passes inside executionContext with ModelResponse prior', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.89, 'Coherent.'));

    const prior = makeModelResponse('Use approach A.');
    const dummyTest = makeDummyTest('consistent-pass-modelresponse');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Approach A is the best choice here.').toBeConsistentWith(prior),
      ),
    ).resolves.not.toThrow();
  });

  it('toBeConsistentWith assertion fails inside executionContext when contradiction is detected', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.1, 'Direct reversal.'));

    const dummyTest = makeDummyTest('consistent-fail');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Never use approach A.')
          .toBeConsistentWith('Approach A is ideal.'),
      ),
    ).rejects.toThrow('JUDGE_FAILED');
  });

  it('not.toBeConsistentWith passes when contradiction is expected', async () => {
    mockExecute.mockResolvedValue(makeJudgeResponse(0.08, 'Clear reversal.'));

    const dummyTest = makeDummyTest('consistent-not');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('Never do X.')
          .not.toBeConsistentWith('Always do X.', { threshold: 0.8 }),
      ),
    ).resolves.not.toThrow();
  });
});
