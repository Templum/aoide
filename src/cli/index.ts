import { existsSync, writeFileSync, watch } from 'node:fs';
import { glob } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../utils/config.js';
import { setSnapshotFlags } from '../cache/snapshot-manager.js';
import { Suite, rootSuite, resetRootSuite } from '../core/ast.js';
import { runSuite, type RunnerOptions } from '../core/runner.js';
import { setupJudge, setupEmbedder } from '../api/setup.js';
import { setGlobalConcurrency, setRetryPolicy } from '../core/dispatcher.js';
import { buildReporters } from '../reporters/factory.js';
import { EXCLUDED_DIRS, createExcludeFilter } from '../utils/files.js';
import { TelemetryTracker } from '../telemetry/tracker.js';
import { parseCliArgs, HELP_TEXT } from './args.js';
import type { AoideConfig } from '../utils/config.js';

function hasFailed(suite: Suite): boolean {
  if (suite.tests.some(t => t.status === 'failed')) return true;
  if (suite.afterAllErrors.length > 0) return true;
  return suite.childSuites.some(hasFailed);
}

/** Shared flag set to true if any file's suite had failures. */
let anyFileFailed = false;


async function runTestFiles(
  testFiles: string[],
  config: AoideConfig,
  runnerOptions: RunnerOptions = {},
): Promise<void> {
  anyFileFailed = false;
  const reporters = buildReporters(config);
  const defaultTimeout = config.defaultTestTimeout ?? 30_000;

  // Load all test files into a single aggregate root so reporters receive one
  // onRunStart / onRunComplete call covering the full run, producing a single
  // unified report with aggregated telemetry.
  const aggregateRoot = new Suite('<root>');
  TelemetryTracker.reset();

  for (const file of testFiles) {
    resetRootSuite();
    // Cache-busting query param ensures Node re-evaluates the module on each watch run.
    await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    // Move the suites and top-level tests registered by this file into the aggregate root.
    aggregateRoot.adoptFrom(rootSuite);
  }

  // Run the full aggregate suite once — reporters fire onRunStart and onRunComplete once.
  await runSuite(aggregateRoot, reporters, defaultTimeout, true, [], [], false, runnerOptions);

  if (hasFailed(aggregateRoot)) anyFileFailed = true;
}

const INIT_CONFIG = `import type { AoideConfig } from 'aoide';

const config: AoideConfig = {
  judge: {
    target: { provider: 'openai', model: 'gpt-4o-mini' },
    temperature: 0.0,
  },
  reporters: ['terminal', 'json'],
  testMatch: ['**/*.promptest.ts'],
};

export default config;
`;

const INIT_EXAMPLE = `import { describe, it, expect, beforeAll, registerProvider, runPrompt } from 'aoide';
import type { ModelTarget } from 'aoide';

// Register your provider here. Example uses LM Studio.
// import { LMStudioProvider } from 'aoide/providers/lmstudio';
// beforeAll(() => {
//   registerProvider(new LMStudioProvider('local:lmstudio'));
// });

const target: ModelTarget = { provider: 'openai', model: 'gpt-4o-mini' };

describe('Basic smoke test', () => {
  it('responds to a simple question', async () => {
    const response = await runPrompt(target, {
      messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
      temperature: 0.0,
    });

    expect(response.text).toContain('hello world');
  });
});
`;

async function runInit(force: boolean): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'aoide.config.ts');
  const exampleDir = join(cwd, 'examples');
  const examplePath = join(exampleDir, 'basic.promptest.ts');

  let wrote = false;

  if (!existsSync(configPath) || force) {
    writeFileSync(configPath, INIT_CONFIG, 'utf8');
    console.log(`Created: aoide.config.ts`);
    wrote = true;
  } else {
    console.log(`Skipped: aoide.config.ts (already exists, use --force to overwrite)`);
  }

  if (!existsSync(examplePath) || force) {
    if (!existsSync(exampleDir)) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(exampleDir, { recursive: true });
    }
    writeFileSync(examplePath, INIT_EXAMPLE, 'utf8');
    console.log(`Created: examples/basic.promptest.ts`);
    wrote = true;
  } else {
    console.log(`Skipped: examples/basic.promptest.ts (already exists, use --force to overwrite)`);
  }

  if (wrote) {
    console.log('\nRun your tests with: npx aoide');
  }
}

export async function runCLI(args: string[]): Promise<void> {
  const flags = parseCliArgs(args);

  // Handle --help / -h
  if (flags.help) {
    console.log(HELP_TEXT);
    return;
  }

  // Handle `init` sub-command (case-insensitive).
  if (args[0]?.toLowerCase() === 'init') {
    const force = args.includes('--force');
    await runInit(force);
    return;
  }

  setSnapshotFlags({ noCache: flags.noCache, updateSnapshots: flags.updateSnapshots });

  if (flags.maxWorkers !== undefined) {
    setGlobalConcurrency(flags.maxWorkers);
  }

  const config = await loadConfig({
    configPath: flags.config,
    testMatch: flags.testMatch,
    reporters: flags.reporters,
    jsonOutputPath: flags.jsonOutput,
  });

  // Retry policy: CLI flag overrides config, config overrides defaults.
  const maxRetries = flags.maxRetries ?? config.retryPolicy?.maxRetries ?? 3;
  const backoffMs = config.retryPolicy?.backoffMs ?? 100;
  setRetryPolicy(maxRetries, backoffMs);

  if (config.judge !== undefined) {
    setupJudge(config.judge);
  }

  if (config.embedder !== undefined) {
    setupEmbedder(config.embedder);
  }

  TelemetryTracker.seedCache(config);

  // Build runner options from CLI flags.
  const runnerOptions: RunnerOptions = {};
  if (flags.grep !== undefined) {
    runnerOptions.grepPattern = new RegExp(flags.grep);
  }

  // --timeout CLI flag overrides config default.
  if (flags.timeout !== undefined) {
    config.defaultTestTimeout = flags.timeout;
  }

  const cwd = process.cwd();
  const patterns = config.testMatch ?? ['**/*.promptest.ts'];

  async function resolveTestFiles(): Promise<string[]> {
    const files: string[] = [];
    const exclude = createExcludeFilter(EXCLUDED_DIRS);
    for (const pattern of patterns) {
      for await (const entry of glob(pattern, { cwd, exclude })) {
        files.push(resolve(cwd, entry));
      }
    }
    return files;
  }

  let testFiles = await resolveTestFiles();

  if (testFiles.length === 0) {
    console.error(`No test files found matching: ${patterns.join(', ')}`);
    process.exit(1);
  }

  if (flags.watch) {
    console.log(`Watching ${testFiles.length} test file(s) for changes... (Ctrl+C to stop)\n`);

    await runTestFiles(testFiles, config, runnerOptions);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    // Store handles so we can close them on shutdown.
    const watchHandles: ReturnType<typeof watch>[] = [];

    // Watch the parent directories of all currently-known test files.
    // On 'rename' events we also re-glob to detect newly created test files.
    const watchDirs = new Set(testFiles.map(f => resolve(f, '..')));

    // Also watch the config file's directory so changes to aoide.config.ts
    // trigger a re-run without requiring the watcher to be restarted.
    const resolvedConfigPath = resolve(cwd, flags.config ?? 'aoide.config.ts');
    watchDirs.add(resolve(resolvedConfigPath, '..'));

    for (const dir of watchDirs) {
      const handle = watch(dir, { recursive: false }, (eventType, filename) => {
        if (!filename) return;

        // Always clear the previous timer before setting a new one.
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          void (async () => {
            debounceTimer = null;

            // 'rename' signals a file was created or deleted — re-glob so that
            // newly added test files are picked up without restarting the watcher.
            if (eventType === 'rename') {
              const updated = await resolveTestFiles();
              const oldSet = new Set(testFiles);
              const newSet = new Set(updated);
              const changed =
                updated.some(f => !oldSet.has(f)) || testFiles.some(f => !newSet.has(f));
              if (changed) {
                testFiles = updated;
                console.log(`\nTest file list updated — watching ${testFiles.length} file(s).\n`);
              }
              // If the renamed file is a test file (or was one), re-run.
              const changedPath = resolve(dir, filename);
              if (!newSet.has(changedPath) && !oldSet.has(changedPath)) return;
            } else {
              // 'change' — only re-run if the modified file is a known test file
              // or the config file.
              const changed = resolve(dir, filename);
              if (!testFiles.includes(changed) && changed !== resolvedConfigPath) return;
            }

            if (running) return;
            running = true;
            console.log(`\nFile changed: ${filename} — re-running tests...\n`);
            try {
              TelemetryTracker.resetCache();
              await runTestFiles(testFiles, config, runnerOptions);
            } catch (err) {
              console.error('[aoide] Unexpected error during watch re-run:', (err as Error).message);
            } finally {
              running = false;
            }
          })();
        }, 100);
      });
      watchHandles.push(handle);
    }

    // Gracefully close watchers and exit on SIGINT / SIGTERM.
    const cleanup = (): void => {
      for (const h of watchHandles) h.close();
      process.exit(anyFileFailed ? 1 : 0);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    // Keep the process alive.
    await new Promise<never>(() => {});
  } else {
    await runTestFiles(testFiles, config, runnerOptions);

    if (anyFileFailed) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}
