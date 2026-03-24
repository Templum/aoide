import { describe, it, expect } from 'vitest';
import { setupJudge, getJudgeConfig } from '../../../src/api/setup.js';

describe('setup', () => {
  it('getJudgeConfig returns config set by setupJudge', () => {
    setupJudge({ target: { provider: 'mock', model: 'my-judge' }, temperature: 0.2 });
    const config = getJudgeConfig();
    expect(config.target.provider).toBe('mock');
    expect(config.target.model).toBe('my-judge');
    expect(config.temperature).toBe(0.2);
  });
});
