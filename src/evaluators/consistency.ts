import type { ModelTarget } from '../providers/types.js';
import { runJudge } from './judge.js';

// ---------------------------------------------------------------------------
// toBeFactuallyConsistent
// ---------------------------------------------------------------------------

export interface FactualConsistencyOptions {
  /** Minimum score to pass (0.0–1.0). Defaults to 0.8. */
  threshold?: number;
  /** Override the globally configured judge model for this assertion. */
  judgeOverride?: ModelTarget;
}

/**
 * Verifies that `actual` does not contradict or hallucinate facts relative
 * to `referenceText`. Useful for RAG pipelines and summarisation tests.
 *
 * Scores close to 1.0 mean the text is fully faithful to the reference.
 * Scores close to 0.0 mean the text contains contradictions or invented facts.
 */
export async function checkFactualConsistency(
  actual: string,
  referenceText: string,
  options?: FactualConsistencyOptions,
): Promise<void> {
  const criteria =
    `Verify that the evaluated text is factually faithful to the reference document below.\n\n` +
    `Reference document:\n"""\n${referenceText}\n"""\n\n` +
    `Check for all of the following:\n` +
    `1. Direct contradictions — does the text assert something the reference explicitly denies?\n` +
    `2. Hallucinations — does the text introduce specific facts (names, dates, numbers, events) not present in the reference?\n` +
    `3. Unsupported generalisations — does the text draw conclusions not warranted by the reference?\n\n` +
    `Score 1.0 = fully faithful, no unsupported claims.\n` +
    `Score 0.0 = extensive contradictions or hallucinations.`;

  await runJudge({
    text: actual,
    criteria,
    threshold: options?.threshold ?? 0.8,
    judgeOverride: options?.judgeOverride,
  });
}

// ---------------------------------------------------------------------------
// toMatchPersona
// ---------------------------------------------------------------------------

export interface MatchPersonaOptions {
  /** Minimum score to pass (0.0–1.0). Defaults to 0.7. */
  threshold?: number;
  /** Override the globally configured judge model for this assertion. */
  judgeOverride?: ModelTarget;
}

/**
 * Asserts the response is consistent with a defined persona description.
 * Evaluates voice, style, vocabulary, and characteristic communication
 * patterns — distinct from tone (which concerns emotional register).
 *
 * @example
 * await expect(response).toMatchPersona(
 *   'a senior software engineer who is direct and prefers bullet points',
 * );
 */
export async function checkMatchPersona(
  actual: string,
  persona: string,
  options?: MatchPersonaOptions,
): Promise<void> {
  const criteria =
    `The response must be consistent with the following persona:\n"${persona}"\n\n` +
    `Evaluate the voice, style, and characteristic communication patterns. Specifically check:\n` +
    `1. Does the vocabulary and word choice match the persona?\n` +
    `2. Is the level of formality or informality appropriate for the persona?\n` +
    `3. Do the patterns of expression, structure, and style reflect how this persona would communicate?\n` +
    `4. Are any characteristic behaviours described in the persona present?\n\n` +
    `Do NOT evaluate factual accuracy or content — only voice, style, and persona fit.\n\n` +
    `Score 1.0 = the response could only have been written by this persona.\n` +
    `Score 0.0 = the response bears no resemblance to how this persona would communicate.`;

  await runJudge({
    text: actual,
    criteria,
    threshold: options?.threshold ?? 0.7,
    judgeOverride: options?.judgeOverride,
  });
}

// ---------------------------------------------------------------------------
// toBeConsistentWith
// ---------------------------------------------------------------------------

export interface ConsistentWithOptions {
  /** Minimum score to pass (0.0–1.0). Defaults to 0.8. */
  threshold?: number;
  /** Override the globally configured judge model for this assertion. */
  judgeOverride?: ModelTarget;
}

/**
 * Multi-turn consistency check. Asserts the new response does not contradict
 * a prior response — verifying conversation coherence and position stability.
 *
 * @example
 * await expect(followUpResponse).toBeConsistentWith(firstResponse);
 */
export async function checkConsistentWith(
  actual: string,
  priorResponse: string,
  options?: ConsistentWithOptions,
): Promise<void> {
  const criteria =
    `Verify that the new response is logically consistent with the prior response below.\n\n` +
    `Prior response:\n"""\n${priorResponse}\n"""\n\n` +
    `Check for all of the following:\n` +
    `1. Direct contradictions — does the new response assert the opposite of something in the prior response?\n` +
    `2. Reversed positions — does the new response abandon or negate a stance taken in the prior response?\n` +
    `3. Incompatible claims — are there assertions in the new response that cannot both be true alongside the prior response?\n\n` +
    `Note: the new response may elaborate, add nuance, or address a different aspect — this is not a contradiction.\n\n` +
    `Score 1.0 = fully coherent, no contradictions.\n` +
    `Score 0.0 = the new response directly contradicts the prior response.`;

  await runJudge({
    text: actual,
    criteria,
    threshold: options?.threshold ?? 0.8,
    judgeOverride: options?.judgeOverride,
  });
}
