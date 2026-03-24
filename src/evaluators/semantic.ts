import { getProvider } from '../providers/registry.js';
import { getEmbedderConfig, getJudgeConfig } from '../api/setup.js';
import { cosineSimilarity } from '../utils/math.js';
import { JudgeError } from '../utils/errors.js';
import { runJudge } from './judge.js';
import { EvalCacheManager } from '../cache/eval-cache.js';
import type { ModelResponse } from '../providers/types.js';

const TONE_DESCRIPTORS: Record<string, string> = {
  empathetic: 'warm, understanding, and compassionate — it acknowledges the user\'s feelings',
  professional: 'formal, clear, and business-appropriate — it avoids casual language',
  urgent: 'direct and time-sensitive — it conveys urgency without being alarmist',
};

/**
 * Compares two texts for semantic similarity using vector embeddings and cosine similarity.
 */
export async function checkSemanticSimilarity(
  actual: string,
  expected: string,
  threshold = 0.85,
): Promise<void> {
  const { target } = getEmbedderConfig();
  const provider = getProvider(target.provider);

  if (!provider.getEmbeddings) {
    throw new Error(
      `Provider "${target.provider}" does not support embeddings. Use a provider that implements getEmbeddings().`,
    );
  }

  // Build a deterministic cache key from the two input texts.
  // We use a synthetic PromptRequest so the eval cache hash function can
  // treat embedding calls the same way it treats judge calls.
  const cacheRequest = {
    messages: [{ role: 'user' as const, content: JSON.stringify([actual, expected]) }],
  };

  const cached = EvalCacheManager.get('embedding', target, cacheRequest);

  let embeddings: number[][];

  if (cached !== null) {
    // The cached entry stores the embeddings in rawResponse, serialised when
    // the result was first saved below.
    embeddings = cached.rawResponse as number[][];
  } else {
    const embeddingResponse = await provider.getEmbeddings(target.model, {
      input: [actual, expected],
    });

    if (embeddingResponse.embeddings.length !== 2) {
      throw new Error(
        `Expected 2 embeddings from provider "${target.provider}" but received ` +
        `${embeddingResponse.embeddings.length}. This is a provider implementation bug.`,
      );
    }

    embeddings = embeddingResponse.embeddings;

    // Persist to eval cache. We store embeddings in rawResponse and use zero
    // usage/metadata values since this path doesn't go through the dispatcher.
    const cacheEntry: ModelResponse = {
      text: '',
      rawResponse: embeddings,
      usage: {
        promptTokens: embeddingResponse.usage.promptTokens,
        completionTokens: 0,
        totalTokens: embeddingResponse.usage.totalTokens,
      },
      metadata: {
        latencyMs: embeddingResponse.metadata.latencyMs,
        providerId: embeddingResponse.metadata.providerId,
        model: embeddingResponse.metadata.model,
      },
    };
    EvalCacheManager.save('embedding', target, cacheRequest, cacheEntry);
  }

  const [vecActual, vecExpected] = embeddings;
  const score = cosineSimilarity(vecActual, vecExpected);

  if (score < threshold) {
    throw new JudgeError(score, 'Text is not semantically similar to the expected reference.', threshold);
  }
}

/**
 * Checks that the given text exhibits the requested tone using the LLM judge.
 */
export async function checkTone(
  text: string,
  tone: 'empathetic' | 'professional' | 'urgent' | string,
  options?: { threshold?: number },
): Promise<void> {
  const descriptor = TONE_DESCRIPTORS[tone] ?? tone;

  let threshold: number;
  if (options?.threshold !== undefined) {
    threshold = options.threshold;
  } else {
    try {
      threshold = getJudgeConfig().defaultThreshold ?? 0.7;
    } catch {
      // Judge not configured — fall back to module default
      threshold = 0.7;
    }
  }

  await runJudge({
    text,
    criteria: `The text must sound ${descriptor}.`,
    threshold,
  });
}
