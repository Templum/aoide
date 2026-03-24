import type { ModelResponse } from '../../src/providers/types.js';
import { Suite, Test } from '../../src/core/ast.js';

export function makeResponse(text: string, overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    text,
    rawResponse: {},
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    metadata: { latencyMs: 42, providerId: 'mock', model: 'mock-model' },
    ...overrides,
  };
}

export function makeDummyTest(name = 'dummy'): Test {
  const suite = new Suite('dummy-suite');
  return new Test(name, async () => {}, suite);
}
