import type { AoideConfig } from 'aoide';
import { LMStudioProvider } from 'aoide/providers/lmstudio';
import { registerProvider } from 'aoide';

registerProvider(new LMStudioProvider('local:lmstudio', 'http://localhost:1234/v1'));

const config: AoideConfig = {
  judge: {
    target: { provider: 'local:lmstudio', model: 'google/gemma-3-12b' },
    temperature: 0.0,
  },
  defaultTestTimeout: 5 * 60 * 1000,
  reporters: ['terminal'],
  testMatch: ['tests/integration/**/*.promptest.ts'],
};

export default config;
