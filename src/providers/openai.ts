import type { LLMProvider, PromptRequest, ModelResponse, EmbeddingRequest, EmbeddingResponse } from './types.js';
import { ApiError } from '../utils/errors.js';

interface OpenAIResponseBody {
  choices: Array<{ message: { role: string; content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAIEmbeddingResponseBody {
  data: Array<{ embedding: number[] }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

function isOpenAIEmbeddingResponseBody(value: unknown): value is OpenAIEmbeddingResponseBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v['data']) &&
    typeof v['usage'] === 'object' &&
    v['usage'] !== null
  );
}

function isOpenAIResponseBody(value: unknown): value is OpenAIResponseBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v['choices']) &&
    typeof (v['choices'] as unknown[])[0] === 'object' &&
    typeof v['usage'] === 'object'
  );
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    public readonly id: string,
    private readonly apiKey: string,
    private readonly baseURL: string = 'https://api.openai.com/v1',
  ) {}

  async execute(model: string, request: PromptRequest): Promise<ModelResponse> {
    const messages = request.system
      ? [{ role: 'system', content: request.system }, ...request.messages]
      : [...request.messages];

    const payload: Record<string, unknown> = { model, messages };
    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }

    const start = performance.now();
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(
        response.status,
        `OpenAI request failed: ${response.statusText}${body ? ` — ${body}` : ''}`,
      );
    }

    const json: unknown = await response.json();
    const latencyMs = performance.now() - start;

    if (!isOpenAIResponseBody(json)) {
      throw new Error('OpenAI returned an unexpected response shape');
    }

    return {
      text: json.choices[0].message.content,
      rawResponse: json,
      usage: {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        totalTokens: json.usage.total_tokens,
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
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(
        response.status,
        `OpenAI embeddings request failed: ${response.statusText}${body ? ` — ${body}` : ''}`,
      );
    }

    const json: unknown = await response.json();
    const latencyMs = performance.now() - start;

    if (!isOpenAIEmbeddingResponseBody(json)) {
      throw new Error('OpenAI returned an unexpected embeddings response shape');
    }

    return {
      embeddings: json.data.map((item) => item.embedding),
      usage: {
        promptTokens: json.usage.prompt_tokens,
        totalTokens: json.usage.total_tokens,
      },
      metadata: {
        latencyMs,
        providerId: this.id,
        model,
      },
    };
  }
}
