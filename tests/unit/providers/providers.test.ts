import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LMStudioProvider } from '../../../src/providers/lmstudio.js';
import { OllamaProvider } from '../../../src/providers/ollama.js';
import type { PromptRequest } from '../../../src/providers/base.js';

const MOCK_OPENAI_RESPONSE = {
  id: 'chatcmpl-123',
  choices: [{ message: { role: 'assistant', content: 'I am a helpful assistant.' } }],
  usage: { prompt_tokens: 15, completion_tokens: 6, total_tokens: 21 },
};

const MOCK_OLLAMA_RESPONSE = {
  model: 'llama3',
  message: { role: 'assistant', content: 'Ollama responding here.' },
  prompt_eval_count: 12,
  eval_count: 5,
};

const BASE_REQUEST: PromptRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
};

function mockFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

function mockFetchError(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Internal Server Error',
  });
}

describe('LMStudioProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOk(MOCK_OPENAI_RESPONSE));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends request to the correct LM Studio URL with proper payload', async () => {
    const provider = new LMStudioProvider('lmstudio');
    await provider.execute('phi-3', BASE_REQUEST);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('phi-3');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('prepends system message when provided', async () => {
    const provider = new LMStudioProvider('lmstudio');
    await provider.execute('phi-3', { ...BASE_REQUEST, system: 'You are helpful.' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('parses MOCK_OPENAI_RESPONSE into a valid ModelResponse', async () => {
    const provider = new LMStudioProvider('lmstudio');
    const result = await provider.execute('phi-3', BASE_REQUEST);

    expect(result.text).toBe('I am a helpful assistant.');
    expect(result.usage).toEqual({ promptTokens: 15, completionTokens: 6, totalTokens: 21 });
    expect(result.metadata.providerId).toBe('lmstudio');
    expect(result.metadata.model).toBe('phi-3');
    expect(typeof result.metadata.latencyMs).toBe('number');
  });

  it('throws an Error on a 500 response', async () => {
    vi.stubGlobal('fetch', mockFetchError(500));
    const provider = new LMStudioProvider('lmstudio');
    await expect(provider.execute('phi-3', BASE_REQUEST)).rejects.toThrow(Error);
  });
});

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOk(MOCK_OLLAMA_RESPONSE));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends request to the correct Ollama URL with proper payload', async () => {
    const provider = new OllamaProvider('ollama');
    await provider.execute('llama3', BASE_REQUEST);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('includes temperature in options', async () => {
    const provider = new OllamaProvider('ollama');
    await provider.execute('llama3', { ...BASE_REQUEST, temperature: 0.7 });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.options.temperature).toBe(0.7);
  });

  it('prepends system message when provided', async () => {
    const provider = new OllamaProvider('ollama');
    await provider.execute('llama3', { ...BASE_REQUEST, system: 'Be concise.' });

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be concise.' });
  });

  it('parses MOCK_OLLAMA_RESPONSE into a valid ModelResponse', async () => {
    const provider = new OllamaProvider('ollama');
    const result = await provider.execute('llama3', BASE_REQUEST);

    expect(result.text).toBe('Ollama responding here.');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 5, totalTokens: 17 });
    expect(result.metadata.providerId).toBe('ollama');
    expect(result.metadata.model).toBe('llama3');
  });

  it('falls back to 0 for missing token counts', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ ...MOCK_OLLAMA_RESPONSE, prompt_eval_count: undefined, eval_count: undefined }));
    const provider = new OllamaProvider('ollama');
    const result = await provider.execute('llama3', BASE_REQUEST);

    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('throws an Error on a 500 response', async () => {
    vi.stubGlobal('fetch', mockFetchError(500));
    const provider = new OllamaProvider('ollama');
    await expect(provider.execute('llama3', BASE_REQUEST)).rejects.toThrow(Error);
  });
});
