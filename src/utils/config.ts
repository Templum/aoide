import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JudgeConfig, EmbedderConfig } from '../api/setup.js';
import { isObject } from './guards.js';

export interface PricingEntry {
  input: number;
  output: number;
}

export interface RetryPolicy {
  /** Maximum number of retry attempts on transient API errors. Defaults to 3. */
  maxRetries?: number;
  /** Base back-off in ms. Actual delay uses full-jitter exponential back-off. Defaults to 100. */
  backoffMs?: number;
}

export interface AoideConfig {
  judge?: JudgeConfig;
  embedder?: EmbedderConfig;
  testMatch?: string[];
  reporters?: string[];
  pricingOverrides?: Record<string, PricingEntry>;
  /** Default timeout in ms for each test. Defaults to 30 000. */
  defaultTestTimeout?: number;
  /** Output path for the JSON reporter. Defaults to 'aoide-results.json'. */
  jsonReporterOutputPath?: string;
  /** Retry policy for transient API failures (429, 503, network errors). */
  retryPolicy?: RetryPolicy;
}

/** @deprecated Use {@link AoideConfig} instead. */
export type PromptestConfig = AoideConfig;

const DEFAULTS: Required<Pick<AoideConfig, 'testMatch' | 'reporters'>> = {
  testMatch: ['**/*.promptest.ts'],
  reporters: ['terminal'],
};

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`Invalid aoide config: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

function validateModelTarget(raw: unknown, fieldPath: string): void {
  if (!isObject(raw)) {
    throw new ConfigValidationError(`"${fieldPath}" must be an object`);
  }
  if (typeof raw['provider'] !== 'string' || raw['provider'].length === 0) {
    throw new ConfigValidationError(`"${fieldPath}.provider" must be a non-empty string`);
  }
  if (typeof raw['model'] !== 'string' || raw['model'].length === 0) {
    throw new ConfigValidationError(`"${fieldPath}.model" must be a non-empty string`);
  }
}

function validateConfig(raw: unknown): PromptestConfig {
  if (!isObject(raw)) {
    throw new ConfigValidationError('config must export a default object');
  }

  if (raw['judge'] !== undefined) {
    if (!isObject(raw['judge'])) {
      throw new ConfigValidationError('"judge" must be an object');
    }
    validateModelTarget(raw['judge']['target'], 'judge.target');
    if (raw['judge']['temperature'] !== undefined && typeof raw['judge']['temperature'] !== 'number') {
      throw new ConfigValidationError('"judge.temperature" must be a number');
    }
    if (raw['judge']['defaultThreshold'] !== undefined) {
      const dt = raw['judge']['defaultThreshold'];
      if (typeof dt !== 'number' || dt < 0 || dt > 1) {
        throw new ConfigValidationError('"judge.defaultThreshold" must be a number between 0 and 1');
      }
    }
  }

  if (raw['embedder'] !== undefined) {
    if (!isObject(raw['embedder'])) {
      throw new ConfigValidationError('"embedder" must be an object');
    }
    validateModelTarget(raw['embedder']['target'], 'embedder.target');
  }

  if (raw['defaultTestTimeout'] !== undefined) {
    if (typeof raw['defaultTestTimeout'] !== 'number') {
      throw new ConfigValidationError('"defaultTestTimeout" must be a number');
    }
    if (raw['defaultTestTimeout'] <= 0) {
      throw new ConfigValidationError('"defaultTestTimeout" must be a positive number greater than 0');
    }
  }

  if (raw['testMatch'] !== undefined) {
    if (!Array.isArray(raw['testMatch']) || !(raw['testMatch'] as unknown[]).every(x => typeof x === 'string')) {
      throw new ConfigValidationError('"testMatch" must be an array of strings');
    }
  }

  if (raw['reporters'] !== undefined) {
    if (!Array.isArray(raw['reporters']) || !(raw['reporters'] as unknown[]).every(x => typeof x === 'string')) {
      throw new ConfigValidationError('"reporters" must be an array of strings');
    }
  }

  if (raw['retryPolicy'] !== undefined) {
    if (!isObject(raw['retryPolicy'])) {
      throw new ConfigValidationError('"retryPolicy" must be an object');
    }
    if (raw['retryPolicy']['maxRetries'] !== undefined && typeof raw['retryPolicy']['maxRetries'] !== 'number') {
      throw new ConfigValidationError('"retryPolicy.maxRetries" must be a number');
    }
    if (raw['retryPolicy']['backoffMs'] !== undefined && typeof raw['retryPolicy']['backoffMs'] !== 'number') {
      throw new ConfigValidationError('"retryPolicy.backoffMs" must be a number');
    }
  }

  return raw as unknown as PromptestConfig;
}

export interface ConfigOverrides {
  configPath?: string;
  testMatch?: string;
  reporters?: string[];
  jsonOutputPath?: string;
}

export async function loadConfig(overrides: ConfigOverrides = {}): Promise<PromptestConfig> {
  const resolvedPath = resolve(process.cwd(), overrides.configPath ?? 'aoide.config.ts');

  let fileConfig: PromptestConfig = {};

  if (existsSync(resolvedPath)) {
    const module = await import(pathToFileURL(resolvedPath).href);
    // Validate the exported config object before using it; surface errors early
    // with a clear message rather than failing deep inside a test run.
    fileConfig = validateConfig(module.default);
  } else if (overrides.configPath !== undefined) {
    // User explicitly provided a --config path but it doesn't exist — fail fast.
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  // CLI flags take precedence over file config, which takes precedence over defaults.
  return {
    ...DEFAULTS,
    ...fileConfig,
    ...(overrides.testMatch !== undefined ? { testMatch: [overrides.testMatch] } : {}),
    ...(overrides.reporters !== undefined ? { reporters: overrides.reporters } : {}),
    ...(overrides.jsonOutputPath !== undefined ? { jsonReporterOutputPath: overrides.jsonOutputPath } : {}),
  };
}
