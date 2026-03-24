import type { ModelTarget, PromptRequest, ModelResponse } from '../providers/types.js';
import { getCurrentTest } from '../core/context.js';
import { getJudgeConfig } from './setup.js';
import { isJudgeResult } from './guards.js';
import type { TournamentConfig, TournamentResult } from './types.js';
import { ParseError, JudgeError } from '../utils/errors.js';
import { dispatcher } from '../core/dispatcher.js';
import { extractJsonText } from '../utils/llm-text.js';
import { SnapshotManager } from '../cache/snapshot-manager.js';
import { EvalCacheManager } from '../cache/eval-cache.js';
import { TelemetryTracker } from '../telemetry/tracker.js';

/**
 * Internal: dispatch an evaluator prompt with eval-specific caching.
 *
 * Judge and tournament evaluation calls are cached under
 * `__prompt_snapshots__/eval/` — separate from the application snapshot cache
 * so that `--update-snapshots` only refreshes app prompts, never eval results.
 * Both caches share the same `--no-cache` flag.
 */
export async function dispatchRaw(target: ModelTarget, request: PromptRequest): Promise<ModelResponse> {
  const cached = EvalCacheManager.get('judge', target, request);
  if (cached !== null) {
    await TelemetryTracker.record(target, cached.usage, 'eval', true);
    return cached;
  }

  const response = await dispatcher.dispatch(target, request);
  EvalCacheManager.save('judge', target, request, response);
  await TelemetryTracker.record(target, response.usage, 'eval');
  return response;
}

export async function runPrompt(
  target: ModelTarget,
  request: PromptRequest,
  options?: { noCache?: boolean },
): Promise<ModelResponse> {
  // Throws if called outside an `it` block — intentional fail-fast behavior.
  getCurrentTest();

  if (!options?.noCache) {
    const cached = SnapshotManager.get(target, request);
    if (cached !== null) {
      await TelemetryTracker.record(target, cached.usage, 'app', true);
      return cached;
    }
  }

  const response = await dispatcher.dispatch(target, request);
  if (!options?.noCache) {
    SnapshotManager.save(target, request, response);
  }
  await TelemetryTracker.record(target, response.usage, 'app');
  return response;
}

export async function runTournament(name: string, config: TournamentConfig): Promise<TournamentResult> {
  // Throws if called outside an `it` block — same contract as runPrompt.
  getCurrentTest();

  const { targets, request, judgeCriteria, iterations = 1 } = config;
  const judgeTarget: ModelTarget = getJudgeConfig().target;

  const scoreboard = await Promise.all(
    targets.map(async (target) => {
      const responses: ModelResponse[] = [];
      const reasoning: string[] = [];
      let totalScore = 0;

      // When running multiple iterations each call must hit the live API so that
      // results are independent. With iterations === 1 the cache is still used.
      const iterationOptions = iterations > 1 ? { noCache: true } : undefined;

      for (let i = 0; i < iterations; i++) {
        const response = await runPrompt(target, request, iterationOptions);
        responses.push(response);

        const judgeRequest: PromptRequest = {
          messages: [
            {
              role: 'user',
              content:
                `Tournament: "${name}"\n\n` +
                `Evaluate the following response against the criteria.\n\n` +
                `Response:\n"""\n${response.text}\n"""\n\n` +
                `Criteria:\n${judgeCriteria}\n\n` +
                `Respond with STRICTLY valid JSON:\n` +
                `{"score": <0.0-1.0>, "reasoning": "<brief explanation>"}`,
            },
          ],
        };

        const judgeResponse = await dispatchRaw(judgeTarget, judgeRequest);

        let parsed: unknown;
        try {
          parsed = JSON.parse(extractJsonText(judgeResponse.text));
        } catch {
          throw new ParseError(
            `Tournament judge returned invalid JSON for target ${target.provider}:${target.model}. ` +
            `Raw: ${judgeResponse.text}`,
          );
        }

        if (!isJudgeResult(parsed)) {
          throw new ParseError(
            `Tournament judge response missing required fields for ${target.provider}:${target.model}.`,
          );
        }

        totalScore += parsed.score;
        reasoning.push(parsed.reasoning);
      }

      return {
        target,
        averageScore: totalScore / iterations,
        responses,
        reasoning,
      };
    }),
  );

  const sorted = scoreboard.slice().sort((a, b) => b.averageScore - a.averageScore);
  const top = sorted[0];

  if (top === undefined) {
    throw new JudgeError(0, 'No targets provided to runTournament', 0);
  }

  return {
    winner: top.target,
    scores: sorted,
  };
}
