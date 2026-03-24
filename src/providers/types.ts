export interface PromptRequest {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  rawResponse: unknown;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata: {
    latencyMs: number;
    providerId: string;
    model: string;
  };
}

export interface ModelTarget {
  provider: string;
  model: string;
}

export interface EmbeddingRequest {
  input: string | string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
  metadata: {
    latencyMs: number;
    providerId: string;
    model: string;
  };
}

export interface LLMProvider {
  id: string;
  execute(model: string, request: PromptRequest): Promise<ModelResponse>;
  getEmbeddings?(model: string, request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
