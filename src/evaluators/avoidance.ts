import type { ModelTarget } from '../providers/types.js';
import { runJudge } from './judge.js';

export interface AvoidTopicsOptions {
  /** Minimum score to pass (0.0–1.0). Defaults to 0.8. */
  threshold?: number;
  /** Override the globally configured judge model for this assertion. */
  judgeOverride?: ModelTarget;
}

/**
 * Verifies the response does NOT discuss any of the listed forbidden topics.
 * More powerful than `not.toContain()` because it catches paraphrasing and
 * indirect references, not just literal string matches.
 *
 * The topics array is sorted before use so cache hits are order-independent.
 *
 * @example
 * await expect(response).toAvoidTopics(['competitor pricing', 'legal liability']);
 */
export async function checkAvoidTopics(
  actual: string,
  topics: string[],
  options?: AvoidTopicsOptions,
): Promise<void> {
  if (topics.length === 0) {
    throw new TypeError('toAvoidTopics: topics array must contain at least one topic.');
  }

  // Sort for deterministic cache keys regardless of call-site ordering.
  const sortedTopics = [...topics].sort();
  const topicsList = sortedTopics.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const criteria =
    `The response must NOT discuss, mention, or allude to any of the following topics,\n` +
    `including paraphrasing, synonyms, or indirect references:\n\n` +
    `${topicsList}\n\n` +
    `Check for all of the following:\n` +
    `1. Direct mentions of any topic by name or clear synonym\n` +
    `2. Paraphrased or indirect references that a reasonable reader would associate with the topic\n` +
    `3. Implicit discussions where the topic is the evident subject, even without naming it\n\n` +
    `Score 1.0 = the response completely avoids all listed topics.\n` +
    `Score 0.0 = the response extensively discusses one or more listed topics.`;

  await runJudge({
    text: actual,
    criteria,
    threshold: options?.threshold ?? 0.8,
    judgeOverride: options?.judgeOverride,
  });
}
