import type { ModelTarget, ModelResponse, PromptRequest } from '../providers/types.js';

export interface EmbedderConfig {
  target: ModelTarget;
}

export interface JudgeConfig {
  target: ModelTarget;
  temperature?: number;
  systemPrompt?: string;
  /**
   * Project-level default threshold for toPassLLMJudge / toHaveTone assertions (0.0–1.0).
   * Individual call-sites can still override this with their own `threshold` option.
   * Defaults to 0.7 when not set.
   */
  defaultThreshold?: number;
}

export interface JudgeResult {
  score: number;
  reasoning: string;
}

export interface TournamentConfig {
  targets: ModelTarget[];
  request: PromptRequest;
  judgeCriteria: string;
  iterations?: number;
}

export interface TournamentResult {
  winner: ModelTarget;
  scores: Array<{
    target: ModelTarget;
    averageScore: number;
    responses: ModelResponse[];
    reasoning: string[];
  }>;
}
