import type { ModelTarget } from '../providers/types.js';
import { runJudge } from './judge.js';

export interface StructuralEquivalenceOptions {
  /** Minimum score to pass (0.0–1.0). Defaults to 0.75. */
  threshold?: number;
  /** Override the globally configured judge model for this assertion. */
  judgeOverride?: ModelTarget;
}

/**
 * Checks that a response follows a described logical or rhetorical structure
 * without comparing semantic meaning.
 *
 * `expectedStructure` is a natural-language description of the required
 * organisation (e.g. `"intro paragraph → 3 bullet points → conclusion"`),
 * not an example response to mimic.
 *
 * @example
 * await expect(response).toBeStructurallyEquivalent(
 *   'greeting, then a numbered list of 3–5 options, then a closing question',
 * );
 */
export async function checkStructuralEquivalence(
  actual: string,
  expectedStructure: string,
  options?: StructuralEquivalenceOptions,
): Promise<void> {
  const criteria =
    `Evaluate whether the text follows this structural pattern:\n"${expectedStructure}"\n\n` +
    `Check for all of the following:\n` +
    `1. Are all required structural elements present (e.g. introduction, numbered list, conclusion)?\n` +
    `2. Are the elements in the correct order as described?\n` +
    `3. Do quantitative constraints match (e.g. "3 bullet points", "two sections")?\n` +
    `4. Does the overall rhetorical shape match the described pattern?\n\n` +
    `Do NOT evaluate the semantic content or factual accuracy — only structure and organisation.\n\n` +
    `Score 1.0 = the text perfectly follows the described structural pattern.\n` +
    `Score 0.0 = the text bears no resemblance to the described structure.`;

  await runJudge({
    text: actual,
    criteria,
    threshold: options?.threshold ?? 0.75,
    judgeOverride: options?.judgeOverride,
  });
}
