import { describe, it, expect as vitestExpect, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { checkTokenBudget, checkCostBudget } from '../../../src/evaluators/budget.js';
import { computeCost } from '../../../src/telemetry/tracker.js';
import { expect } from '../../../src/api/assertions.js';
import type { ModelResponse, ModelTarget } from '../../../src/providers/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  promptTokens: number,
  completionTokens: number,
): ModelResponse {
  return {
    text: 'hello',
    rawResponse: {},
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    metadata: { latencyMs: 10, providerId: 'test', model: 'test-model' },
  };
}

const ANTHROPIC_TARGET: ModelTarget = {
  provider: 'anthropic',
  model: 'claude-3-5-haiku-20241022',
};

const LOCAL_TARGET: ModelTarget = {
  provider: 'local',
  model: 'llama3.2',
};

// ---------------------------------------------------------------------------
// computeCost
// ---------------------------------------------------------------------------

describe('computeCost', () => {
  it('returns 0 for local provider (no overrides)', () => {
    const usage = { promptTokens: 10_000, completionTokens: 5_000, totalTokens: 15_000 };
    vitestExpect(computeCost(LOCAL_TARGET, usage)).toBe(0);
  });

  it('returns 0 for provider starting with "local:"', () => {
    const target: ModelTarget = { provider: 'local:ollama', model: 'mistral' };
    const usage = { promptTokens: 100, completionTokens: 100, totalTokens: 200 };
    vitestExpect(computeCost(target, usage)).toBe(0);
  });

  it('calculates cost using bundled pricing for known models', () => {
    // claude-3-5-haiku pricing: input $0.80/M, output $4.00/M
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = computeCost(ANTHROPIC_TARGET, usage);
    vitestExpect(cost).toBeGreaterThan(0);
  });

  it('respects pricingOverrides exact match', () => {
    const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 2, output: 8 } };
    // 100 prompt + 50 completion = (100 * 2 + 50 * 8) / 1_000_000 = 600 / 1_000_000 = 0.0006
    const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const cost = computeCost(ANTHROPIC_TARGET, usage, overrides);
    vitestExpect(cost).toBeCloseTo(0.0006, 10);
  });

  it('respects pricingOverrides wildcard match', () => {
    const overrides = { 'local:*': { input: 1, output: 2 } };
    const target: ModelTarget = { provider: 'local', model: 'any-model' };
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000, totalTokens: 2_000_000 };
    const cost = computeCost(target, usage, overrides);
    // (1M * 1 + 1M * 2) / 1M = 3
    vitestExpect(cost).toBeCloseTo(3, 6);
  });

  it('returns 0 for unknown model without override', () => {
    const target: ModelTarget = { provider: 'unknown-cloud', model: 'mystery-model-v1' };
    const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    vitestExpect(computeCost(target, usage)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkTokenBudget
// ---------------------------------------------------------------------------

describe('checkTokenBudget', () => {
  it('passes when total tokens are below the limit', () => {
    const r = makeResponse(100, 50); // total = 150
    vitestExpect(() => checkTokenBudget(r, 200)).not.toThrow();
  });

  it('fails when total tokens equal the limit (exclusive upper bound)', () => {
    const r = makeResponse(100, 100); // total = 200
    vitestExpect(() => checkTokenBudget(r, 200)).toThrow(assert.AssertionError);
  });

  it('fails when total tokens exceed the limit', () => {
    const r = makeResponse(300, 200); // total = 500
    vitestExpect(() => checkTokenBudget(r, 400)).toThrow('Expected total tokens (500) to be below 400');
  });

  it('checks prompt tokens when dimension is "prompt"', () => {
    const r = makeResponse(150, 50); // prompt=150, total=200
    vitestExpect(() => checkTokenBudget(r, 100, { dimension: 'prompt' })).toThrow(
      'Expected prompt tokens (150) to be below 100',
    );
    vitestExpect(() => checkTokenBudget(r, 200, { dimension: 'prompt' })).not.toThrow();
  });

  it('checks completion tokens when dimension is "completion"', () => {
    const r = makeResponse(50, 300); // completion=300, total=350
    vitestExpect(() => checkTokenBudget(r, 200, { dimension: 'completion' })).toThrow(
      'Expected completion tokens (300) to be below 200',
    );
    vitestExpect(() => checkTokenBudget(r, 500, { dimension: 'completion' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// checkCostBudget
// ---------------------------------------------------------------------------

describe('checkCostBudget', () => {
  it('passes for local model (cost = $0 < any budget)', () => {
    const r = makeResponse(100_000, 50_000);
    vitestExpect(() => checkCostBudget(r, 0.001, LOCAL_TARGET)).not.toThrow();
  });

  it('fails for local model when budget is $0 (exclusive bound)', () => {
    // cost = 0, maxCost = 0 → 0 >= 0 → should throw (exclusive upper bound)
    const r = makeResponse(1000, 1000);
    vitestExpect(() => checkCostBudget(r, 0, LOCAL_TARGET)).toThrow(assert.AssertionError);
  });

  it('passes when cost is below the budget', () => {
    const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 1, output: 2 } };
    // 100 prompt + 50 completion = (100*1 + 50*2)/1M = 0.0002
    const r = makeResponse(100, 50);
    vitestExpect(() => checkCostBudget(r, 0.001, ANTHROPIC_TARGET, { pricingOverrides: overrides })).not.toThrow();
  });

  it('fails when cost equals the budget (exclusive)', () => {
    const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 1, output: 0 } };
    // 1M prompt * $1/M = $1.00 exactly
    const r = makeResponse(1_000_000, 0);
    vitestExpect(() => checkCostBudget(r, 1.0, ANTHROPIC_TARGET, { pricingOverrides: overrides })).toThrow(
      assert.AssertionError,
    );
  });

  it('fails when cost exceeds the budget and message contains formatted values', () => {
    const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 10, output: 0 } };
    // 2M prompt * $10/M = $20.00
    const r = makeResponse(2_000_000, 0);
    vitestExpect(() => checkCostBudget(r, 5.0, ANTHROPIC_TARGET, { pricingOverrides: overrides })).toThrow(
      /Expected cost \(\$20\.000000\) to be below \$5\.000000/,
    );
  });

  it('includes provider:model in the error message', () => {
    const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 10, output: 0 } };
    const r = makeResponse(2_000_000, 0);
    vitestExpect(() => checkCostBudget(r, 1, ANTHROPIC_TARGET, { pricingOverrides: overrides })).toThrow(
      'anthropic:claude-3-5-haiku-20241022',
    );
  });
});

// ---------------------------------------------------------------------------
// ExpectBuilder integration — toHaveTokensBelow
// ---------------------------------------------------------------------------

describe('expect(response).toHaveTokensBelow', () => {
  it('passes when tokens are within budget', () => {
    const r = makeResponse(100, 50); // total=150
    vitestExpect(() => expect(r).toHaveTokensBelow(200)).not.toThrow();
  });

  it('fails when tokens exceed budget', () => {
    const r = makeResponse(300, 200); // total=500
    vitestExpect(() => expect(r).toHaveTokensBelow(400)).toThrow(
      'Expected total tokens (500) to be below 400',
    );
  });

  it('respects dimension option', () => {
    const r = makeResponse(250, 50); // prompt=250
    vitestExpect(() => expect(r).toHaveTokensBelow(100, { dimension: 'prompt' })).toThrow(
      'Expected prompt tokens (250) to be below 100',
    );
  });

  it('throws TypeError for non-ModelResponse input', () => {
    vitestExpect(() => expect('plain string').toHaveTokensBelow(500)).toThrow(TypeError);
  });

  it('negation passes when tokens exceed budget', () => {
    const r = makeResponse(600, 0); // total=600
    vitestExpect(() => expect(r).not.toHaveTokensBelow(300)).not.toThrow();
  });

  it('negation fails when tokens are within budget', () => {
    const r = makeResponse(50, 50); // total=100
    vitestExpect(() => expect(r).not.toHaveTokensBelow(500)).toThrow(
      'Expected assertion to fail, but it passed.',
    );
  });
});

// ---------------------------------------------------------------------------
// ExpectBuilder integration — toHaveCostBelow
// ---------------------------------------------------------------------------

describe('expect(response).toHaveCostBelow', () => {
  const overrides = { 'anthropic:claude-3-5-haiku-20241022': { input: 1, output: 2 } };
  // 100 prompt + 50 completion = (100*1 + 50*2)/1M = 0.0002

  it('passes when cost is within budget', () => {
    const r = makeResponse(100, 50);
    vitestExpect(() =>
      expect(r).toHaveCostBelow(0.001, ANTHROPIC_TARGET, { pricingOverrides: overrides }),
    ).not.toThrow();
  });

  it('fails when cost exceeds budget', () => {
    const r = makeResponse(1_000_000, 1_000_000); // cost = (1M*1 + 1M*2)/1M = 3
    vitestExpect(() =>
      expect(r).toHaveCostBelow(1.0, ANTHROPIC_TARGET, { pricingOverrides: overrides }),
    ).toThrow(assert.AssertionError);
  });

  it('local model always passes for any positive budget', () => {
    const r = makeResponse(999_999, 999_999);
    vitestExpect(() => expect(r).toHaveCostBelow(0.001, LOCAL_TARGET)).not.toThrow();
  });

  it('throws TypeError for non-ModelResponse input', () => {
    vitestExpect(() => expect(42).toHaveCostBelow(0.01, ANTHROPIC_TARGET)).toThrow(TypeError);
  });

  it('negation passes when cost exceeds budget', () => {
    const r = makeResponse(2_000_000, 0); // cost = (2M*1)/1M = 2 > 1
    vitestExpect(() =>
      expect(r).not.toHaveCostBelow(1.0, ANTHROPIC_TARGET, { pricingOverrides: overrides }),
    ).not.toThrow();
  });

  it('negation fails when cost is within budget', () => {
    const r = makeResponse(100, 0);
    vitestExpect(() =>
      expect(r).not.toHaveCostBelow(0.01, ANTHROPIC_TARGET, { pricingOverrides: overrides }),
    ).toThrow('Expected assertion to fail, but it passed.');
  });
});
