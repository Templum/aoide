import AjvModule from 'ajv';
// ajv uses a CommonJS default export; handle both ESM interop shapes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = (AjvModule as any).default ?? AjvModule;
import assert from 'node:assert/strict';
import type { ModelTarget, ModelResponse } from '../providers/types.js';
import { isModelResponse } from '../providers/guards.js';
import { runJudge } from '../evaluators/judge.js';
import { checkSemanticSimilarity, checkTone } from '../evaluators/semantic.js';
import { checkFactualConsistency, checkMatchPersona, checkConsistentWith } from '../evaluators/consistency.js';
import { checkStructuralEquivalence } from '../evaluators/structure.js';
import { checkAvoidTopics } from '../evaluators/avoidance.js';
import { checkTokenBudget, checkCostBudget } from '../evaluators/budget.js';
import type { TokenBudgetOptions, CostBudgetOptions } from '../evaluators/budget.js';
import { SchemaError } from '../utils/errors.js';
import { extractJsonText } from '../utils/llm-text.js';
import type { JsonObject } from '../utils/types.js';
import { getCurrentTest } from '../core/context.js';

// Module-level ajv singleton — compiled schemas are cached internally by ajv.
const ajv = new Ajv({ allErrors: true });
// Secondary cache keyed by a deterministic JSON string for schemas created inline
// (new object literals on every call bypass AJV's identity-based cache).
const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

/**
 * Returns a deterministic cache key for a JSON Schema object by recursively
 * sorting object keys before serialising. This prevents cache misses when two
 * logically identical schemas are expressed with different key orderings.
 */
function deterministicStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const sorted = Object.keys(value as object)
      .sort()
      .map(k => JSON.stringify(k) + ':' + deterministicStringify((value as Record<string, unknown>)[k]));
    return '{' + sorted.join(',') + '}';
  }
  return JSON.stringify(value);
}

function extractText(actual: unknown, methodName: string): string {
  if (isModelResponse(actual)) return actual.text;
  if (typeof actual === 'string') return actual;
  throw new TypeError(
    `Unsupported type for ${methodName}: expected string or ModelResponse, got ${typeof actual}`,
  );
}

function extractNumber(actual: unknown, methodName: string): number {
  if (typeof actual === 'number') return actual;
  throw new TypeError(
    `Unsupported type for ${methodName}: expected number, got ${typeof actual}`,
  );
}

/**
 * Extracts a value suitable for JSON Schema validation.
 * - ModelResponse: parses .text as JSON
 * - string: parses as JSON
 * - anything else (object, array, etc.): passed through directly
 */
function extractJsonValue(actual: unknown, methodName: string): unknown {
  if (isModelResponse(actual)) {
    const cleaned = extractJsonText(actual.text);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const detail = err instanceof SyntaxError ? ` (${err.message})` : '';
      throw new SchemaError(`Expected valid JSON in response text but received: ${actual.text}${detail}`);
    }
  }
  if (typeof actual === 'string') {
    const cleaned = extractJsonText(actual);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      const detail = err instanceof SyntaxError ? ` (${err.message})` : '';
      throw new SchemaError(`Expected valid JSON string but received: ${actual}${detail}`);
    }
  }
  // Already an object/array/primitive — validate directly.
  if (actual === null || typeof actual === 'object' || Array.isArray(actual)) {
    return actual;
  }
  throw new TypeError(
    `Unsupported type for ${methodName}: expected string, ModelResponse, or object, got ${typeof actual}`,
  );
}

function validateJsonSchema(value: unknown, schema: JsonObject): void {
  const cacheKey = deterministicStringify(schema);
  let validate = schemaCache.get(cacheKey);
  if (validate === undefined) {
    validate = ajv.compile(schema);
    schemaCache.set(cacheKey, validate);
  }
  if (!validate(value)) {
    const errors = validate.errors ?? [];
    const message = errors
      .map((e: { instancePath: string; message?: string }) => `${e.instancePath || 'root'}: ${e.message ?? 'unknown error'}`)
      .join('; ');
    throw new SchemaError(`JSON schema validation failed — ${message}`);
  }
}

export interface ExpectBuilder {
  /** The negated form of this builder — each assertion is inverted. */
  not: ExpectBuilder;
  toBe(expected: unknown): ExpectBuilder;
  toBeNull(): ExpectBuilder;
  toBeDefined(): ExpectBuilder;
  toBeUndefined(): ExpectBuilder;
  toBeTruthy(): ExpectBuilder;
  toBeFalsy(): ExpectBuilder;
  toBeLessThan(value: number): ExpectBuilder;
  toBeLessThanOrEqual(value: number): ExpectBuilder;
  toBeGreaterThan(value: number): ExpectBuilder;
  toBeGreaterThanOrEqual(value: number): ExpectBuilder;
  toContain(expected: string, options?: { ignoreCase?: boolean }): ExpectBuilder;
  toMatchJsonSchema(schema: JsonObject): ExpectBuilder;
  toMatchExactFormat(regex: RegExp): ExpectBuilder;
  /**
   * LLM-as-judge assertion. **Must be awaited** — forgetting `await` silently drops the assertion.
   * @example await expect(response).toPassLLMJudge({ criteria: 'Is concise', threshold: 0.8 });
   */
  toPassLLMJudge(options: {
    criteria: string;
    threshold?: number;
    judgeOverride?: ModelTarget;
  }): Promise<ExpectBuilder>;
  /**
   * Semantic similarity via embeddings. **Must be awaited.**
   * @example await expect(response).toBeSemanticallySimilarTo('The capital is Paris.', 0.85);
   */
  toBeSemanticallySimilarTo(expectedText: string, threshold?: number): Promise<ExpectBuilder>;
  /**
   * Tone check via LLM judge. **Must be awaited.**
   * @example await expect(response).toHaveTone('professional');
   */
  toHaveTone(
    tone: 'empathetic' | 'professional' | 'urgent' | string,
    options?: { threshold?: number },
  ): Promise<ExpectBuilder>;
  /**
   * Factual consistency check via LLM judge. **Must be awaited.**
   * Verifies the response does not contradict or hallucinate facts relative
   * to a reference document. Useful for RAG pipelines and summarisation tests.
   * @example await expect(summary).toBeFactuallyConsistent(sourceDocument, { threshold: 0.8 });
   */
  toBeFactuallyConsistent(
    referenceText: string,
    options?: { threshold?: number; judgeOverride?: ModelTarget },
  ): Promise<ExpectBuilder>;
  /**
   * Structural equivalence check via LLM judge. **Must be awaited.**
   * Verifies the response follows a described logical/rhetorical structure
   * without comparing semantic meaning.
   * @example await expect(response).toBeStructurallyEquivalent('intro → 3 bullet points → conclusion');
   */
  toBeStructurallyEquivalent(
    expectedStructure: string,
    options?: { threshold?: number; judgeOverride?: ModelTarget },
  ): Promise<ExpectBuilder>;
  /**
   * Topic avoidance check via LLM judge. **Must be awaited.**
   * Verifies the response does NOT discuss forbidden topics, catching
   * paraphrasing and indirect references that `not.toContain()` would miss.
   * @example await expect(response).toAvoidTopics(['competitor pricing', 'legal liability']);
   */
  toAvoidTopics(
    topics: string[],
    options?: { threshold?: number; judgeOverride?: ModelTarget },
  ): Promise<ExpectBuilder>;
  /**
   * Persona consistency check via LLM judge. **Must be awaited.**
   * Verifies the response matches a defined persona description in terms of
   * voice, style, vocabulary, and characteristic communication patterns.
   * @example await expect(response).toMatchPersona('a senior engineer who is direct and uses bullet points');
   */
  toMatchPersona(
    persona: string,
    options?: { threshold?: number; judgeOverride?: ModelTarget },
  ): Promise<ExpectBuilder>;
  /**
   * Multi-turn consistency check via LLM judge. **Must be awaited.**
   * Verifies the response does not contradict a prior response — useful for
   * testing conversation coherence and position stability across turns.
   * @example await expect(followUp).toBeConsistentWith(firstResponse);
   */
  toBeConsistentWith(
    priorResponse: string | ModelResponse,
    options?: { threshold?: number; judgeOverride?: ModelTarget },
  ): Promise<ExpectBuilder>;
  /**
   * Asserts the response's token count is strictly below `maxTokens`.
   * Works with all providers including local models (Ollama, LMStudio).
   * Use `options.dimension` to check only prompt or completion tokens.
   * @example expect(response).toHaveTokensBelow(500);
   * @example expect(response).toHaveTokensBelow(200, { dimension: 'completion' });
   */
  toHaveTokensBelow(maxTokens: number, options?: TokenBudgetOptions): ExpectBuilder;
  /**
   * Asserts the computed API cost of the response is strictly below `maxCost` (in USD).
   * Uses the bundled pricing table (same as the telemetry system).
   * Local providers (Ollama, LMStudio) always cost $0 unless you supply
   * `options.pricingOverrides` — useful for asserting zero-cost local runs.
   * @example expect(response).toHaveCostBelow(0.01, { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' });
   */
  toHaveCostBelow(maxCost: number, target: ModelTarget, options?: CostBudgetOptions): ExpectBuilder;
}

function makeBuilder(actual: unknown, negated = false): ExpectBuilder {
  function pass(run: () => void): void {
    if (!negated) {
      run();
    } else {
      let threw = false;
      try { run(); } catch { threw = true; }
      if (!threw) {
        throw new assert.AssertionError({ message: 'Expected assertion to fail, but it passed.' });
      }
    }
  }

  async function passAsync(run: () => Promise<void>): Promise<void> {
    if (!negated) {
      await run();
    } else {
      let threw = false;
      try { await run(); } catch { threw = true; }
      if (!threw) {
        throw new assert.AssertionError({ message: 'Expected assertion to fail, but it passed.' });
      }
    }
  }

  const builder: ExpectBuilder = {
    get not(): ExpectBuilder {
      return makeBuilder(actual, !negated);
    },

    toBe(expected: unknown): ExpectBuilder {
      pass(() => assert.strictEqual(actual, expected));
      return builder;
    },

    toBeNull(): ExpectBuilder {
      pass(() => {
        if (actual !== null) {
          throw new assert.AssertionError({
            message: negated ? 'Expected value NOT to be null' : 'Expected value to be null',
            actual,
            expected: null,
            operator: 'toBeNull',
          });
        }
      });
      return builder;
    },

    toBeDefined(): ExpectBuilder {
      pass(() => {
        if (actual === undefined) {
          throw new assert.AssertionError({
            message: 'Expected value to be defined, but it was undefined',
            actual,
            expected: 'defined',
            operator: 'toBeDefined',
          });
        }
      });
      return builder;
    },

    toBeUndefined(): ExpectBuilder {
      pass(() => {
        if (actual !== undefined) {
          throw new assert.AssertionError({
            message: 'Expected value to be undefined',
            actual,
            expected: undefined,
            operator: 'toBeUndefined',
          });
        }
      });
      return builder;
    },

    toBeTruthy(): ExpectBuilder {
      pass(() => {
        if (!actual) {
          throw new assert.AssertionError({
            message: `Expected value to be truthy, but received ${String(actual)}`,
            actual,
            expected: 'truthy',
            operator: 'toBeTruthy',
          });
        }
      });
      return builder;
    },

    toBeFalsy(): ExpectBuilder {
      pass(() => {
        if (actual) {
          throw new assert.AssertionError({
            message: `Expected value to be falsy, but received ${String(actual)}`,
            actual,
            expected: 'falsy',
            operator: 'toBeFalsy',
          });
        }
      });
      return builder;
    },

    toBeLessThan(value: number): ExpectBuilder {
      pass(() => {
        const num = extractNumber(actual, 'toBeLessThan');
        if (num >= value) {
          throw new assert.AssertionError({
            message: `Expected ${num} to be less than ${value}`,
            actual: num,
            expected: value,
            operator: 'toBeLessThan',
          });
        }
      });
      return builder;
    },

    toBeLessThanOrEqual(value: number): ExpectBuilder {
      pass(() => {
        const num = extractNumber(actual, 'toBeLessThanOrEqual');
        if (num > value) {
          throw new assert.AssertionError({
            message: `Expected ${num} to be less than or equal to ${value}`,
            actual: num,
            expected: value,
            operator: 'toBeLessThanOrEqual',
          });
        }
      });
      return builder;
    },

    toBeGreaterThan(value: number): ExpectBuilder {
      pass(() => {
        const num = extractNumber(actual, 'toBeGreaterThan');
        if (num <= value) {
          throw new assert.AssertionError({
            message: `Expected ${num} to be greater than ${value}`,
            actual: num,
            expected: value,
            operator: 'toBeGreaterThan',
          });
        }
      });
      return builder;
    },

    toBeGreaterThanOrEqual(value: number): ExpectBuilder {
      pass(() => {
        const num = extractNumber(actual, 'toBeGreaterThanOrEqual');
        if (num < value) {
          throw new assert.AssertionError({
            message: `Expected ${num} to be greater than or equal to ${value}`,
            actual: num,
            expected: value,
            operator: 'toBeGreaterThanOrEqual',
          });
        }
      });
      return builder;
    },

    toContain(expected: string, options?: { ignoreCase?: boolean }): ExpectBuilder {
      pass(() => {
        const text = extractText(actual, 'toContain');
        const ignoreCase = options?.ignoreCase ?? false;
        const found = ignoreCase
          ? text.toLowerCase().includes(expected.toLowerCase())
          : text.includes(expected);
        if (!found) {
          const caseNote = ignoreCase ? ' (case-insensitive)' : '';
          const message = negated
            ? `Expected value NOT to contain "${expected}"${caseNote}`
            : `Expected value to contain "${expected}"${caseNote}`;
          throw new assert.AssertionError({
            message,
            actual: text,
            expected,
            operator: 'toContain',
          });
        }
      });
      return builder;
    },

    toMatchJsonSchema(schema: JsonObject): ExpectBuilder {
      pass(() => {
        const value = extractJsonValue(actual, 'toMatchJsonSchema');
        validateJsonSchema(value, schema);
      });
      return builder;
    },

    toMatchExactFormat(regex: RegExp): ExpectBuilder {
      pass(() => {
        const text = extractText(actual, 'toMatchExactFormat');
        if (!regex.test(text)) {
          throw new assert.AssertionError({
            message: `Expected value to match format ${regex}`,
            actual: text,
            expected: regex.toString(),
            operator: 'toMatchExactFormat',
          });
        }
      });
      return builder;
    },

    async toPassLLMJudge(options: {
      criteria: string;
      threshold?: number;
      judgeOverride?: ModelTarget;
    }): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(async () => {
        const outcome = await runJudge({
          text: extractText(actual, 'toPassLLMJudge'),
          criteria: options.criteria,
          threshold: options.threshold,
          judgeOverride: options.judgeOverride,
        });
        // Attach result to the current test for reporting/inspection.
        try {
          const test = getCurrentTest();
          test.judgeResults.push({ criteria: options.criteria, ...outcome });
        } catch {
          // Outside test context — ignore (e.g., called from programmatic API).
        }
      });

      // Register this promise so the runner can warn if it is never awaited.
      // The .catch() suppresses unhandled-rejection noise — the rejection is
      // already handled by `await assertionPromise` below.
      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toBeSemanticallySimilarTo(expectedText: string, threshold?: number): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkSemanticSimilarity(
          extractText(actual, 'toBeSemanticallySimilarTo'),
          expectedText,
          threshold,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toHaveTone(
      tone: 'empathetic' | 'professional' | 'urgent' | string,
      options?: { threshold?: number },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkTone(extractText(actual, 'toHaveTone'), tone, options),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toBeFactuallyConsistent(
      referenceText: string,
      options?: { threshold?: number; judgeOverride?: ModelTarget },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkFactualConsistency(
          extractText(actual, 'toBeFactuallyConsistent'),
          referenceText,
          options,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toBeStructurallyEquivalent(
      expectedStructure: string,
      options?: { threshold?: number; judgeOverride?: ModelTarget },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkStructuralEquivalence(
          extractText(actual, 'toBeStructurallyEquivalent'),
          expectedStructure,
          options,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toAvoidTopics(
      topics: string[],
      options?: { threshold?: number; judgeOverride?: ModelTarget },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkAvoidTopics(
          extractText(actual, 'toAvoidTopics'),
          topics,
          options,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toMatchPersona(
      persona: string,
      options?: { threshold?: number; judgeOverride?: ModelTarget },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkMatchPersona(
          extractText(actual, 'toMatchPersona'),
          persona,
          options,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    async toBeConsistentWith(
      priorResponse: string | ModelResponse,
      options?: { threshold?: number; judgeOverride?: ModelTarget },
    ): Promise<ExpectBuilder> {
      const assertionPromise = passAsync(() =>
        checkConsistentWith(
          extractText(actual, 'toBeConsistentWith'),
          extractText(priorResponse, 'toBeConsistentWith'),
          options,
        ),
      );

      try {
        const test = getCurrentTest();
        test.pendingAssertions.add(assertionPromise);
        assertionPromise.finally(() => test.pendingAssertions.delete(assertionPromise)).catch(() => {});
      } catch { /* outside test context */ }

      await assertionPromise;
      return builder;
    },

    toHaveTokensBelow(maxTokens: number, options?: TokenBudgetOptions): ExpectBuilder {
      pass(() => {
        if (!isModelResponse(actual)) {
          throw new TypeError(
            `toHaveTokensBelow: expected a ModelResponse, got ${typeof actual}`,
          );
        }
        checkTokenBudget(actual, maxTokens, options);
      });
      return builder;
    },

    toHaveCostBelow(maxCost: number, target: ModelTarget, options?: CostBudgetOptions): ExpectBuilder {
      pass(() => {
        if (!isModelResponse(actual)) {
          throw new TypeError(
            `toHaveCostBelow: expected a ModelResponse, got ${typeof actual}`,
          );
        }
        checkCostBudget(actual, maxCost, target, options);
      });
      return builder;
    },
  };

  return builder;
}

export function expect(actual: unknown): ExpectBuilder {
  return makeBuilder(actual);
}
