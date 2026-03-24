/**
 * Removes all <think>…</think> blocks, including nested ones, by iteratively
 * stripping the innermost (non-nested) blocks until none remain.
 *
 * A single-pass non-greedy regex fails on nested blocks produced by some
 * reasoning models (e.g. DeepSeek-R1 chain-of-thought):
 *   <think>outer <think>inner</think> rest</think>
 * The non-greedy match would leave "<think> rest</think>" behind. Iterating
 * from the inside out handles arbitrary nesting depth correctly.
 */
function stripThinkBlocks(raw: string): string {
  // The inner pattern matches a <think> block that contains no nested <think>.
  const innerBlock = /<think>(?:(?!<think>)[\s\S])*?<\/think>/gi;
  let current = raw;
  let prev: string;
  do {
    prev = current;
    current = current.replace(innerBlock, '');
  } while (current !== prev);
  return current;
}

/**
 * Strips thinking blocks (<think>...</think>) and markdown code fences
 * from raw LLM output before JSON parsing. Handles thinking models
 * (e.g. Qwen3, DeepSeek-R1) that prepend reasoning traces to their response.
 */
export function extractJsonText(raw: string): string {
  return stripThinkBlocks(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}
