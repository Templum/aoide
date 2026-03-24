import type { LLMProvider } from './types.js';

const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Provider not found: "${id}". Registered providers: [${[...providers.keys()].join(', ')}]`);
  }
  return provider;
}
