import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePromptHash } from '../../../src/cache/hash.js';
import { SnapshotManager, setSnapshotFlags } from '../../../src/cache/snapshot-manager.js';
import type { ModelTarget, PromptRequest, ModelResponse } from '../../../src/providers/types.js';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const target: ModelTarget = { provider: 'openai', model: 'gpt-4o' };

const request: PromptRequest = {
  system: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,
};

const mockResponse: ModelResponse = {
  text: 'Hi there!',
  rawResponse: {},
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  metadata: { latencyMs: 200, providerId: 'openai', model: 'gpt-4o' },
};

// ─── Block 1: Hash generation ────────────────────────────────────────────────

describe('generatePromptHash', () => {
  it('produces the same hash for identical target and request', () => {
    const a = generatePromptHash(target, request);
    const b = generatePromptHash({ ...target }, { ...request, messages: [...request.messages] });
    expect(a).toBe(b);
  });

  it('produces a different hash when temperature changes', () => {
    const original = generatePromptHash(target, request);
    const changed = generatePromptHash(target, { ...request, temperature: 0.1 });
    expect(original).not.toBe(changed);
  });

  it('produces a different hash when model changes', () => {
    const original = generatePromptHash(target, request);
    const changed = generatePromptHash({ ...target, model: 'gpt-3.5-turbo' }, request);
    expect(original).not.toBe(changed);
  });

  it('produces a different hash when message content changes', () => {
    const original = generatePromptHash(target, request);
    const changed = generatePromptHash(target, {
      ...request,
      messages: [{ role: 'user', content: 'Different message' }],
    });
    expect(original).not.toBe(changed);
  });
});

// ─── Block 2: SnapshotManager (mocked fs) ────────────────────────────────────

vi.mock('node:fs');

describe('SnapshotManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset flags to default before each test.
    setSnapshotFlags({ noCache: false, updateSnapshots: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('save() writes a JSON file when noCache is false', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    SnapshotManager.save(target, request, mockResponse);

    expect(fs.mkdirSync).toHaveBeenCalledOnce();
    expect(fs.writeFileSync).toHaveBeenCalledOnce();

    const [filePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    expect(filePath).toMatch(/\.json$/);
    const parsed: unknown = JSON.parse(content);
    expect(parsed).toMatchObject({ target, request, response: mockResponse });
  });

  it('save() does NOT write when noCache is true', async () => {
    const fs = await import('node:fs');
    setSnapshotFlags({ noCache: true, updateSnapshots: false });

    SnapshotManager.save(target, request, mockResponse);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('get() returns null when updateSnapshots is true, even if file exists', async () => {
    const fs = await import('node:fs');
    setSnapshotFlags({ noCache: false, updateSnapshots: true });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = SnapshotManager.get(target, request);

    expect(result).toBeNull();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('get() parses and returns a ModelResponse with latencyMs forced to 0', async () => {
    const fs = await import('node:fs');

    const snapshotContent = JSON.stringify({
      hash: 'abc123',
      target,
      request,
      response: mockResponse,
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(snapshotContent);

    const result = SnapshotManager.get(target, request);

    expect(result).not.toBeNull();
    expect(result?.text).toBe(mockResponse.text);
    expect(result?.usage).toEqual(mockResponse.usage);
    // Cache hits always report latencyMs = 0
    expect(result?.metadata.latencyMs).toBe(0);
    // Other metadata fields preserved
    expect(result?.metadata.providerId).toBe(mockResponse.metadata.providerId);
    expect(result?.metadata.model).toBe(mockResponse.metadata.model);
  });
});
