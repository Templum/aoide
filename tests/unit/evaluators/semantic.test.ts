import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkSemanticSimilarity } from '../../../src/evaluators/semantic.js';
import { setupEmbedder } from '../../../src/api/setup.js';
import { registerProvider } from '../../../src/api/setup.js';
import type { LLMProvider, EmbeddingResponse } from '../../../src/providers/types.js';

// ---------------------------------------------------------------------------
// Provider that supports embeddings
// ---------------------------------------------------------------------------

const mockGetEmbeddings = vi.fn<[string, { input: string | string[] }], Promise<EmbeddingResponse>>();

const embeddingProvider: LLMProvider = {
  id: 'mock-embed',
  execute: vi.fn(),
  getEmbeddings: mockGetEmbeddings,
};

// Provider with no embeddings support
const noEmbedProvider: LLMProvider = {
  id: 'mock-no-embed',
  execute: vi.fn(),
};

registerProvider(embeddingProvider);
registerProvider(noEmbedProvider);

beforeEach(() => {
  mockGetEmbeddings.mockReset();
});

describe('checkSemanticSimilarity', () => {
  it('passes when cosine similarity meets threshold', async () => {
    setupEmbedder({ target: { provider: 'mock-embed', model: 'embed-model' } });

    // Two identical unit vectors → cosine similarity = 1.0
    const vec = [1, 0, 0];
    mockGetEmbeddings.mockResolvedValue({
      embeddings: [vec, vec],
      usage: { promptTokens: 5, totalTokens: 5 },
      metadata: { latencyMs: 10, providerId: 'mock-embed', model: 'embed-model' },
    });

    await expect(
      checkSemanticSimilarity('hello', 'hello', 0.85),
    ).resolves.not.toThrow();
  });

  it('throws JudgeError when cosine similarity is below threshold', async () => {
    setupEmbedder({ target: { provider: 'mock-embed', model: 'embed-model' } });

    // Orthogonal vectors → cosine similarity = 0.0
    mockGetEmbeddings.mockResolvedValue({
      embeddings: [[1, 0, 0], [0, 1, 0]],
      usage: { promptTokens: 5, totalTokens: 5 },
      metadata: { latencyMs: 10, providerId: 'mock-embed', model: 'embed-model' },
    });

    await expect(
      checkSemanticSimilarity('cat', 'spaceship', 0.85),
    ).rejects.toThrow();
  });

  it('throws when provider does not support embeddings', async () => {
    setupEmbedder({ target: { provider: 'mock-no-embed', model: 'no-embed-model' } });

    await expect(
      checkSemanticSimilarity('hello', 'world'),
    ).rejects.toThrow('does not support embeddings');
  });
});
