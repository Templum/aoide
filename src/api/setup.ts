import type { LLMProvider } from '../providers/types.js';
import { registerProvider as registryRegister } from '../providers/registry.js';
import type { JudgeConfig, EmbedderConfig } from './types.js';

export type { JudgeConfig, EmbedderConfig } from './types.js';

export function registerProvider(provider: LLMProvider): void {
  registryRegister(provider);
}

export function setProviderConcurrency(_providerId: string, _maxConcurrent: number): void {
  // Concurrency enforcement is handled by the Dispatcher.
  // This stores the limit so the Dispatcher can read it at dispatch time.
  providerConcurrencyLimits.set(_providerId, _maxConcurrent);
}

export function getProviderConcurrency(providerId: string): number | undefined {
  return providerConcurrencyLimits.get(providerId);
}

const providerConcurrencyLimits = new Map<string, number>();

let globalJudgeConfig: JudgeConfig | null = null;

export function setupJudge(config: JudgeConfig): void {
  globalJudgeConfig = config;
}

export function getJudgeConfig(): JudgeConfig {
  if (globalJudgeConfig === null) {
    throw new Error(
      'Judge not configured. Call setupJudge() before using LLM-based assertions.',
    );
  }
  return globalJudgeConfig;
}

let globalEmbedderConfig: EmbedderConfig | null = null;

export function setupEmbedder(config: EmbedderConfig): void {
  globalEmbedderConfig = config;
}

export function getEmbedderConfig(): EmbedderConfig {
  if (globalEmbedderConfig === null) {
    throw new Error(
      'Embedder not configured. Call setupEmbedder() before using semantic similarity assertions.',
    );
  }
  return globalEmbedderConfig;
}
