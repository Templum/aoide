import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig } from '../../../src/utils/config.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn() };
});

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults when no config file exists', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = await loadConfig();

    expect(config.testMatch).toEqual(['**/*.promptest.ts']);
    expect(config.reporters).toEqual(['terminal']);
  });

  it('CLI testMatch override takes precedence over defaults', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = await loadConfig({ testMatch: '**/*.custom.ts' });

    expect(config.testMatch).toEqual(['**/*.custom.ts']);
  });

  it('CLI reporters override takes precedence over defaults', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = await loadConfig({ reporters: ['json'] });

    expect(config.reporters).toEqual(['json']);
  });

  it('throws when explicit --config path does not exist', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      loadConfig({ configPath: 'nonexistent.config.ts' }),
    ).rejects.toThrow('Config file not found');
  });
});
