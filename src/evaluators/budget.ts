import assert from 'node:assert/strict';
import type { ModelResponse, ModelTarget } from '../providers/types.js';
import { computeCost } from '../telemetry/tracker.js';
import type { PricingEntry } from '../utils/config.js';

export interface TokenBudgetOptions {
  /**
   * Which token dimension to check.
   * - `'total'` (default): `promptTokens + completionTokens`
   * - `'prompt'`: input tokens only
   * - `'completion'`: output tokens only
   */
  dimension?: 'total' | 'prompt' | 'completion';
}

export interface CostBudgetOptions {
  /**
   * Custom pricing overrides keyed by `"provider:model"` or `"provider:*"`.
   * Values are per 1,000,000 tokens: `{ input: number, output: number }`.
   * When omitted the bundled pricing.json is used. Local providers default to $0.
   */
  pricingOverrides?: Record<string, PricingEntry>;
}

/**
 * Throws an AssertionError if the response's token count exceeds `maxTokens`.
 *
 * Works with all providers including local models (Ollama, LMStudio) because
 * it operates on the raw `usage` data in `ModelResponse`, not on any external
 * pricing table.
 *
 * @param response  The ModelResponse to inspect.
 * @param maxTokens Exclusive upper bound.
 * @param options   Select which token dimension to check (default: `'total'`).
 *
 * @example
 * checkTokenBudget(response, 500);
 * checkTokenBudget(response, 200, { dimension: 'completion' });
 */
export function checkTokenBudget(
  response: ModelResponse,
  maxTokens: number,
  options?: TokenBudgetOptions,
): void {
  const dimension = options?.dimension ?? 'total';
  const tokenMap = {
    total: response.usage.totalTokens,
    prompt: response.usage.promptTokens,
    completion: response.usage.completionTokens,
  };
  const actual = tokenMap[dimension];

  if (actual >= maxTokens) {
    throw new assert.AssertionError({
      message: `Expected ${dimension} tokens (${actual}) to be below ${maxTokens}`,
      actual,
      expected: maxTokens,
      operator: 'toHaveTokensBelow',
    });
  }
}

/**
 * Throws an AssertionError if the computed cost of a response exceeds `maxCost`.
 *
 * Cost is derived from the bundled `pricing.json` (same as the telemetry system).
 * For local providers (Ollama, LMStudio) the cost is $0 unless you supply
 * `pricingOverrides` — making this a useful assertion to confirm that a local
 * model incurs no API cost.
 *
 * @param response  The ModelResponse to inspect.
 * @param maxCost   Exclusive upper bound in USD.
 * @param target    The `ModelTarget` used to produce this response (for pricing lookup).
 * @param options   Optional `pricingOverrides` to use instead of pricing.json.
 *
 * @example
 * checkCostBudget(response, 0.01, { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' });
 * // Local models always cost $0 unless overridden:
 * checkCostBudget(ollamaResponse, 0.001, { provider: 'local', model: 'llama3.2' });
 */
export function checkCostBudget(
  response: ModelResponse,
  maxCost: number,
  target: ModelTarget,
  options?: CostBudgetOptions,
): void {
  const actualCost = computeCost(target, response.usage, options?.pricingOverrides);

  if (actualCost >= maxCost) {
    const fmt = (n: number) => `$${n.toFixed(6)}`;
    throw new assert.AssertionError({
      message: `Expected cost (${fmt(actualCost)}) to be below ${fmt(maxCost)} for ${target.provider}:${target.model}`,
      actual: actualCost,
      expected: maxCost,
      operator: 'toHaveCostBelow',
    });
  }
}
