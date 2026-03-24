import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, ModelResponse } from '../../../src/providers/types.js';
import { executionContext } from '../../../src/core/context.js';
import { registerProvider, setupJudge } from '../../../src/api/setup.js';
import { expect as promptExpect } from '../../../src/api/assertions.js';
import { makeResponse, makeDummyTest } from '../../shared/factories.js';

vi.mock('../../../src/cache/snapshot-manager.js', () => ({
  SnapshotManager: { get: vi.fn().mockReturnValue(null), save: vi.fn() },
}));
vi.mock('../../../src/cache/eval-cache.js', () => ({
  EvalCacheManager: { get: vi.fn().mockReturnValue(null), save: vi.fn() },
}));

const mockExecute = vi.fn<[string, Parameters<LLMProvider['execute']>[1]], Promise<ModelResponse>>();

registerProvider({ id: 'mock', execute: mockExecute });
registerProvider({ id: 'mock-ext', execute: mockExecute });

beforeEach(() => {
  mockExecute.mockReset();
});

describe('assertions - deterministic', () => {
  it('toBe passes on strict equality and throws on mismatch', () => {
    expect(() => promptExpect('hello').toBe('hello')).not.toThrow();
    expect(() => promptExpect('hello').toBe('world')).toThrow();
    expect(() => promptExpect(42).toBe(42)).not.toThrow();
    expect(() => promptExpect(42).toBe('42')).toThrow();
  });

  it('toContain passes when a plain string includes the substring', () => {
    expect(() => promptExpect('hello world').toContain('world')).not.toThrow();
    expect(() => promptExpect('hello world').toContain('mars')).toThrow();
  });

  it('toContain passes when a ModelResponse text includes the substring', () => {
    const response = makeResponse('The answer is 42');
    expect(() => promptExpect(response).toContain('42')).not.toThrow();
    expect(() => promptExpect(response).toContain('999')).toThrow();
  });

  it('toContain throws on unsupported types', () => {
    expect(() => promptExpect(12345 as any).toContain('1')).toThrow('Unsupported type for toContain');
    expect(() => promptExpect(null as any).toContain('x')).toThrow('Unsupported type for toContain');
  });
});

describe('expect().not — sync assertions', () => {
  it('not.toBe passes when values differ', () => {
    expect(() => promptExpect('hello').not.toBe('world')).not.toThrow();
  });

  it('not.toBe throws when values are equal', () => {
    expect(() => promptExpect('hello').not.toBe('hello')).toThrow();
  });

  it('not.toContain passes when string is absent', () => {
    expect(() => promptExpect('hello world').not.toContain('mars')).not.toThrow();
  });

  it('not.toContain throws when string is present', () => {
    expect(() => promptExpect('hello world').not.toContain('world')).toThrow();
  });

  it('not.toMatchExactFormat passes when regex does not match', () => {
    expect(() => promptExpect('abc').not.toMatchExactFormat(/^\d+$/)).not.toThrow();
  });

  it('not.toMatchExactFormat throws when regex matches', () => {
    expect(() => promptExpect('123').not.toMatchExactFormat(/^\d+$/)).toThrow();
  });

  it('not.toMatchJsonSchema passes when value fails schema', () => {
    expect(() =>
      promptExpect('{"name": 123}').not.toMatchJsonSchema({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }),
    ).not.toThrow();
  });

  it('not.toMatchJsonSchema throws when value passes schema', () => {
    expect(() =>
      promptExpect('{"name": "Alice"}').not.toMatchJsonSchema({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }),
    ).toThrow();
  });
});

describe('numeric comparisons', () => {
  it('toBeGreaterThan passes when num > value', () => {
    expect(() => promptExpect(5).toBeGreaterThan(3)).not.toThrow();
  });

  it('toBeGreaterThan throws when num <= value', () => {
    expect(() => promptExpect(3).toBeGreaterThan(3)).toThrow();
    expect(() => promptExpect(2).toBeGreaterThan(3)).toThrow();
  });

  it('toBeGreaterThanOrEqual passes when num >= value', () => {
    expect(() => promptExpect(3).toBeGreaterThanOrEqual(3)).not.toThrow();
    expect(() => promptExpect(4).toBeGreaterThanOrEqual(3)).not.toThrow();
  });

  it('toBeGreaterThanOrEqual throws when num < value', () => {
    expect(() => promptExpect(2).toBeGreaterThanOrEqual(3)).toThrow();
  });

  it('toBeLessThanOrEqual passes when num <= value', () => {
    expect(() => promptExpect(3).toBeLessThanOrEqual(3)).not.toThrow();
    expect(() => promptExpect(2).toBeLessThanOrEqual(3)).not.toThrow();
  });

  it('toBeLessThanOrEqual throws when num > value', () => {
    expect(() => promptExpect(4).toBeLessThanOrEqual(3)).toThrow();
  });

  it('throws TypeError for non-number input', () => {
    expect(() => promptExpect('hello').toBeGreaterThan(1)).toThrow(TypeError);
  });
});

describe('toMatchJsonSchema — object input', () => {
  it('validates a plain object directly without JSON-parsing', () => {
    expect(() =>
      promptExpect({ name: 'Alice', age: 30 }).toMatchJsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      }),
    ).not.toThrow();
  });

  it('throws SchemaError when object fails schema', () => {
    expect(() =>
      promptExpect({ name: 42 }).toMatchJsonSchema({
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      }),
    ).toThrow();
  });
});

describe('assertions - LLM Judge', () => {
  it('throws when judge score is below threshold, with judge reasoning in the message', async () => {
    setupJudge({ target: { provider: 'mock', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.5, "reasoning": "Too vague."}'));

    const dummyTest = makeDummyTest('judge-test');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('some text').toPassLLMJudge({
          criteria: 'Must be detailed',
          threshold: 0.8,
        }),
      ),
    ).rejects.toThrow('Too vague');
  });

  it('passes when judge score meets or exceeds threshold', async () => {
    setupJudge({ target: { provider: 'mock', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.95, "reasoning": "Very detailed and thorough."}'));

    const dummyTest = makeDummyTest('judge-pass-test');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('a very detailed answer').toPassLLMJudge({
          criteria: 'Must be detailed',
          threshold: 0.8,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('throws when judge returns invalid JSON', async () => {
    setupJudge({ target: { provider: 'mock', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('not valid json'));

    const dummyTest = makeDummyTest('judge-invalid-json');
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('some text').toPassLLMJudge({ criteria: 'any criteria' }),
      ),
    ).rejects.toThrow('invalid JSON');
  });

  it('uses judgeOverride target instead of global judge config', async () => {
    setupJudge({ target: { provider: 'mock', model: 'default-judge' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.5, "reasoning": "Too vague."}'));

    const dummyTest = makeDummyTest();
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('some text').toPassLLMJudge({
          criteria: 'Must be detailed',
          threshold: 0.8,
          judgeOverride: { provider: 'mock', model: 'override-judge' },
        }),
      ),
    ).rejects.toThrow('Too vague');

    expect(mockExecute).toHaveBeenCalledWith('override-judge', expect.anything());
  });
});

describe('toPassLLMJudge — score capture', () => {
  it('attaches judgeResult to the current test when judge passes', async () => {
    setupJudge({ target: { provider: 'mock-ext', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.9, "reasoning": "Excellent response."}'));

    const dummyTest = makeDummyTest('judge-score-capture');
    await executionContext.run(dummyTest, async () => {
      await promptExpect('great answer').toPassLLMJudge({
        criteria: 'Must be excellent',
        threshold: 0.8,
      });
    });

    expect(dummyTest.judgeResults).toHaveLength(1);
    expect(dummyTest.judgeResults[0].score).toBe(0.9);
    expect(dummyTest.judgeResults[0].reasoning).toBe('Excellent response.');
    expect(dummyTest.judgeResults[0].criteria).toBe('Must be excellent');
  });
});

describe('expect().not — async assertions', () => {
  it('not.toPassLLMJudge passes when judge score is below threshold', async () => {
    setupJudge({ target: { provider: 'mock-ext', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.4, "reasoning": "Poor response."}'));

    const dummyTest = makeDummyTest();
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('bad answer').not.toPassLLMJudge({
          criteria: 'Must be excellent',
          threshold: 0.8,
        }),
      ),
    ).resolves.not.toThrow();
  });

  it('not.toPassLLMJudge throws when judge score meets threshold', async () => {
    setupJudge({ target: { provider: 'mock-ext', model: 'judge-model' } });
    mockExecute.mockResolvedValue(makeResponse('{"score": 0.95, "reasoning": "Very good."}'));

    const dummyTest = makeDummyTest();
    await expect(
      executionContext.run(dummyTest, () =>
        promptExpect('great answer').not.toPassLLMJudge({
          criteria: 'Must be excellent',
          threshold: 0.8,
        }),
      ),
    ).rejects.toThrow();
  });
});
