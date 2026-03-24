import type { ModelTarget } from '../providers/types.js';
import { dispatchRaw } from '../api/actions.js';
import { getJudgeConfig } from '../api/setup.js';
import { isJudgeResult } from '../api/guards.js';
import { JudgeError, ParseError } from '../utils/errors.js';
import { extractJsonText } from '../utils/llm-text.js';

export interface RunJudgeOptions {
  text: string;
  criteria: string;
  threshold?: number;
  judgeOverride?: ModelTarget;
}

export interface JudgeOutcome {
  score: number;
  reasoning: string;
}

/** The fallback threshold used when neither the call-site nor JudgeConfig.defaultThreshold specifies one. */
export const DEFAULT_JUDGE_THRESHOLD = 0.7;

export async function runJudge(options: RunJudgeOptions): Promise<JudgeOutcome> {
  const judgeConfig = getJudgeConfig();
  const {
    text,
    criteria,
    // Precedence: call-site option → project-level JudgeConfig.defaultThreshold → module constant
    threshold = judgeConfig.defaultThreshold ?? DEFAULT_JUDGE_THRESHOLD,
    judgeOverride,
  } = options;

  const judgeTarget: ModelTarget = judgeOverride ?? judgeConfig.target;

  const request = {
    system: judgeConfig.systemPrompt,
    messages: [
      {
        role: 'user' as const,
        content:
          `You are an impartial evaluator. Evaluate the following text against the given criteria.\n\n` +
          `Text to evaluate:\n"""\n${text}\n"""\n\n` +
          `Criteria:\n${criteria}\n\n` +
          `Respond with STRICTLY valid JSON in this exact format and nothing else:\n` +
          `{"score": <number between 0.0 and 1.0>, "reasoning": "<brief explanation>"}`,
      },
    ],
  };

  const response = await dispatchRaw(judgeTarget, request);

  const rawText = extractJsonText(response.text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new ParseError(`LLM Judge returned invalid JSON. Raw response: ${response.text}`);
  }

  if (!isJudgeResult(parsed)) {
    throw new ParseError(
      `LLM Judge response missing required fields "score" (number) and "reasoning" (string). ` +
      `Got: ${JSON.stringify(parsed)}`,
    );
  }

  if (!isFinite(parsed.score) || parsed.score < 0 || parsed.score > 1) {
    throw new ParseError(
      `LLM Judge score must be a finite number in [0, 1]. Got: ${parsed.score}`,
    );
  }

  if (parsed.score < threshold) {
    throw new JudgeError(parsed.score, parsed.reasoning, threshold);
  }

  return { score: parsed.score, reasoning: parsed.reasoning };
}
