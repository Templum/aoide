import type { LLMProvider, PromptRequest, ModelResponse, EmbeddingRequest, EmbeddingResponse } from './types.js';
import { ApiError } from '../utils/errors.js';

interface OllamaResponseBody {
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingResponseBody {
  embeddings: number[][];
  prompt_eval_count?: number;
}

function isOllamaEmbeddingResponseBody(value: unknown): value is OllamaEmbeddingResponseBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['embeddings']);
}

function isOllamaResponseBody(value: unknown): value is OllamaResponseBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['message'] === 'object' && v['message'] !== null;
}

export class OllamaProvider implements LLMProvider {
  /**
   * @param id      Provider ID. Use a "local:" prefix (e.g. "local:ollama") to
   *                automatically limit concurrency to 1 — recommended for local models
   *                to avoid overwhelming host resources.
   * @param baseURL Ollama base URL (default: http://127.0.0.1:11434)
   */
  constructor(
    public readonly id: string = 'local:ollama',
    private readonly baseURL: string = 'http://127.0.0.1:11434',
  ) {}

  async execute(model: string, request: PromptRequest): Promise<ModelResponse> {
    const messages = request.system
      ? [{ role: 'system', content: request.system }, ...request.messages]
      : [...request.messages];

    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }

    const payload: Record<string, unknown> = {
      model,
      messages,
      ...(Object.keys(options).length > 0 ? { options } : {}),
      stream: false,
    };

    const start = performance.now();
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Ollama returns JSON with an "error" field; fall back to raw text if
      // parsing fails (e.g. a proxy or network error returned plain HTML).
      let detail: string;
      try {
        const errJson = await response.json() as Record<string, unknown>;
        detail = typeof errJson['error'] === 'string' ? errJson['error'] : JSON.stringify(errJson);
      } catch {
        detail = await response.text();
      }
      throw new ApiError(
        response.status,
        `Ollama request failed: ${response.statusText}${detail ? ` — ${detail}` : ''}`,
      );
    }

    const json: unknown = await response.json();
    const latencyMs = performance.now() - start;

    if (!isOllamaResponseBody(json)) {
      throw new Error('Ollama returned an unexpected response shape');
    }

    return {
      text: json.message.content,
      rawResponse: json,
      usage: {
        promptTokens: json.prompt_eval_count ?? 0,
        completionTokens: json.eval_count ?? 0,
        totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
      },
      metadata: {
        latencyMs,
        providerId: this.id,
        model,
      },
    };
  }

  async getEmbeddings(model: string, request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const payload = { model, input: request.input };

    const start = performance.now();
    const response = await fetch(`${this.baseURL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detail: string;
      try {
        const errJson = await response.json() as Record<string, unknown>;
        detail = typeof errJson['error'] === 'string' ? errJson['error'] : JSON.stringify(errJson);
      } catch {
        detail = await response.text();
      }
      throw new ApiError(
        response.status,
        `Ollama embeddings request failed: ${response.statusText}${detail ? ` — ${detail}` : ''}`,
      );
    }

    const json: unknown = await response.json();
    const latencyMs = performance.now() - start;

    if (!isOllamaEmbeddingResponseBody(json)) {
      throw new Error('Ollama returned an unexpected embeddings response shape');
    }

    const promptTokens = json.prompt_eval_count ?? 0;
    return {
      embeddings: json.embeddings,
      usage: {
        promptTokens,
        totalTokens: promptTokens,
      },
      metadata: {
        latencyMs,
        providerId: this.id,
        model,
      },
    };
  }
}
