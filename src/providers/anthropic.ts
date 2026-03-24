import type { LLMProvider, PromptRequest, ModelResponse } from './types.js';
import { ApiError } from '../utils/errors.js';

interface AnthropicContentBlock {
  type: string;
  text: string;
}

interface AnthropicResponseBody {
  content: AnthropicContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

function isAnthropicResponseBody(value: unknown): value is AnthropicResponseBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v['content']) &&
    typeof v['usage'] === 'object' &&
    v['usage'] !== null &&
    typeof (v['usage'] as Record<string, unknown>)['input_tokens'] === 'number' &&
    typeof (v['usage'] as Record<string, unknown>)['output_tokens'] === 'number'
  );
}

export class AnthropicProvider implements LLMProvider {
  /** The default Anthropic API version used when none is specified. */
  static readonly DEFAULT_API_VERSION = '2024-06-01';

  /**
   * Default max_tokens sent to Anthropic when the caller does not set
   * `maxTokens` on the PromptRequest. Anthropic requires this field in every
   * request, unlike OpenAI which omits it when unspecified. 4 096 is a safe
   * default that avoids silent truncation for most test use-cases.
   */
  static readonly DEFAULT_MAX_TOKENS = 4096;

  constructor(
    public readonly id: string,
    private readonly apiKey: string,
    private readonly baseURL: string = 'https://api.anthropic.com/v1',
    private readonly apiVersion: string = AnthropicProvider.DEFAULT_API_VERSION,
    private readonly defaultMaxTokens: number = AnthropicProvider.DEFAULT_MAX_TOKENS,
  ) {}

  async execute(model: string, request: PromptRequest): Promise<ModelResponse> {
    const payload: Record<string, unknown> = {
      model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
    };

    if (request.system) {
      payload['system'] = request.system;
    }
    if (request.temperature !== undefined) {
      payload['temperature'] = request.temperature;
    }

    const start = performance.now();
    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(
        response.status,
        `Anthropic request failed: ${response.statusText}${body ? ` — ${body}` : ''}`,
      );
    }

    const json: unknown = await response.json();
    const latencyMs = performance.now() - start;

    if (!isAnthropicResponseBody(json)) {
      throw new Error('Anthropic returned an unexpected response shape');
    }

    const textBlock = json.content.find(b => b.type === 'text');
    if (!textBlock) {
      throw new Error('No text content block in Anthropic response');
    }

    const promptTokens = json.usage.input_tokens;
    const completionTokens = json.usage.output_tokens;

    return {
      text: textBlock.text,
      rawResponse: json,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      metadata: {
        latencyMs,
        providerId: this.id,
        model,
      },
    };
  }
}
