import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AoideConfig } from '../utils/config.js';
import { setSnapshotFlags } from '../cache/snapshot-manager.js';
import { rootSuite, resetRootSuite } from '../core/ast.js';
import { runSuite, type RunnerOptions } from '../core/runner.js';
import { setupJudge, setupEmbedder } from './setup.js';
import { setRetryPolicy } from '../core/dispatcher.js';
import { buildReporters } from '../reporters/factory.js';
import { EXCLUDED_DIRS, createExcludeFilter } from '../utils/files.js';
import { TelemetryTracker, type TelemetrySummary } from '../telemetry/tracker.js';
import type { Suite } from '../core/ast.js';

export interface RunTestsOptions {
  /** Inline config — takes precedence over `configPath`. */
  config?: AoideConfig;
  /** Path to an aoide.config.ts file. Defaults to `aoide.config.ts` in cwd. */
  configPath?: string;
  /** Explicit list of test file paths. When provided, `testMatch` globs are ignored. */
  testFiles?: string[];
  /** Regex pattern — only tests whose name matches will run. */
  grep?: string;
  /** Bypass the snapshot cache for this run. */
  noCache?: boolean;
  /** Re-fetch all prompts and update the snapshot cache. */
  updateSnapshots?: boolean;
}

export interface TestRunResult {
  /** Number of tests that passed. */
  passed: number;
  /** Number of tests that failed. */
  failed: number;
  /** Number of tests that were skipped. */
  skipped: number;
  /** Total wall-clock duration across all files in milliseconds. */
  durationMs: number;
  /** Aggregated token usage and cost. */
  telemetry: TelemetrySummary;
  /** Whether any test (or afterAll hook) failed. */
  ok: boolean;
}


function hasSuiteFailed(suite: Suite): boolean {
  if (suite.tests.some(t => t.status === 'failed')) return true;
  if (suite.afterAllErrors.length > 0) return true;
  return suite.childSuites.some(hasSuiteFailed);
}

/**
 * Run promptest tests programmatically.
 *
 * @example
 * ```ts
 * import { runTests } from 'promptest';
 *
 * const result = await runTests({ grep: 'summarise', noCache: true });
 * if (!result.ok) process.exit(1);
 * ```
 */
export async function runTests(options: RunTestsOptions = {}): Promise<TestRunResult> {
  const startMs = Date.now();

  const config: AoideConfig =
    options.config ??
    (await loadConfig({
      configPath: options.configPath,
    }));

  setSnapshotFlags({
    noCache: options.noCache ?? false,
    updateSnapshots: options.updateSnapshots ?? false,
  });

  const retryPolicy = config.retryPolicy ?? {};
  setRetryPolicy(retryPolicy.maxRetries ?? 3, retryPolicy.backoffMs ?? 100);

  if (config.judge !== undefined) setupJudge(config.judge);
  if (config.embedder !== undefined) setupEmbedder(config.embedder);

  TelemetryTracker.seedCache(config);

  // Resolve test files.
  const cwd = process.cwd();
  let testFiles: string[];

  if (options.testFiles !== undefined && options.testFiles.length > 0) {
    testFiles = options.testFiles.map(f => resolve(cwd, f));
  } else {
    const patterns = config.testMatch ?? ['**/*.promptest.ts'];
    testFiles = [];
    const exclude = createExcludeFilter(EXCLUDED_DIRS);
    for (const pattern of patterns) {
      for await (const entry of glob(pattern, { cwd, exclude })) {
        testFiles.push(resolve(cwd, entry));
      }
    }
  }

  const runnerOptions: RunnerOptions = {};
  if (options.grep !== undefined) {
    runnerOptions.grepPattern = new RegExp(options.grep);
  }

  const reporters = buildReporters(config);
  const defaultTimeout = config.defaultTestTimeout ?? 30_000;

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let anyFailed = false;

  for (const file of testFiles) {
    resetRootSuite();
    TelemetryTracker.reset();

    await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    await runSuite(rootSuite, reporters, defaultTimeout, true, [], [], false, runnerOptions);

    // Accumulate per-file counts.
    const allTests = collectAllTests(rootSuite);
    passed += allTests.filter(t => t.status === 'passed').length;
    failed += allTests.filter(t => t.status === 'failed').length;
    skipped += allTests.filter(t => t.status === 'skipped').length;

    if (hasSuiteFailed(rootSuite)) anyFailed = true;
  }

  return {
    passed,
    failed,
    skipped,
    durationMs: Date.now() - startMs,
    telemetry: TelemetryTracker.getSummary(),
    ok: !anyFailed,
  };
}

function collectAllTests(suite: Suite): Array<{ status: string }> {
  return [
    ...suite.tests,
    ...suite.childSuites.flatMap(collectAllTests),
  ];
}
