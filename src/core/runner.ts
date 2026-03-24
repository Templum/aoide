import { type Suite, type Test } from './ast.js';
import { executionContext } from './context.js';
import type { Reporter } from '../reporters/base.js';
import type { HookType } from './ast.js';

const DEFAULT_TIMEOUT_MS = 30_000;

async function executeTest(
  test: Test,
  beforeEachHooks: Array<() => void | Promise<void>>,
  afterEachHooks: Array<() => void | Promise<void>>,
  reporters: Reporter[],
  defaultTimeoutMs: number,
): Promise<void> {
  await executionContext.run(test, async () => {
    for (const r of reporters) await r.onTestStart?.(test);
    const startMs = Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const hook of beforeEachHooks) await hook();

      const timeoutMs = test.timeoutMs ?? defaultTimeoutMs;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Test timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      await Promise.race([test.fn(), timeoutPromise]);

      // Warn when the test body finished but async assertions were created
      // without being awaited. They will not have run and will be silently
      // lost, making the test a false positive.
      if (test.pendingAssertions.size > 0) {
        process.emitWarning(
          `[aoide] Test "${test.name}" has ${test.pendingAssertions.size} async assertion(s) ` +
          `that were not awaited (toPassLLMJudge / toBeSemanticallySimilarTo / toHaveTone). ` +
          `These assertions did not execute. Add \`await\` before each async assertion.`,
          'PromptestWarning',
        );
      }

      test.durationMs = Date.now() - startMs;
      test.status = 'passed';
      for (const r of reporters) await r.onTestPass?.(test);
    } catch (err) {
      test.durationMs = Date.now() - startMs;
      const error = err instanceof Error ? err : new Error(String(err));
      test.status = 'failed';
      test.error = error;
      for (const r of reporters) await r.onTestFail?.(test, error);
    } finally {
      clearTimeout(timeoutHandle);
      for (const hook of afterEachHooks) {
        try {
          await hook();
        } catch (hookErr) {
          const hookError = hookErr instanceof Error ? hookErr : new Error(String(hookErr));
          for (const r of reporters) await r.onHookError?.('afterEach' as HookType, test, hookError);
        }
      }
    }
  });
}

function hasFocusedTest(suite: Suite): boolean {
  if (suite.tests.some(t => t.focused)) return true;
  return suite.childSuites.some(hasFocusedTest);
}

export interface RunnerOptions {
  grepPattern?: RegExp;
}

export async function runSuite(
  suite: Suite,
  reporters: Reporter[] = [],
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  isRoot = true,
  inheritedBeforeEach: Array<() => void | Promise<void>> = [],
  inheritedAfterEach: Array<() => void | Promise<void>> = [],
  anyFocused = false,
  options: RunnerOptions = {},
): Promise<void> {
  if (isRoot) {
    for (const r of reporters) await r.onRunStart?.(suite);
    // Compute once at root and pass down — child suites must not recompute.
    anyFocused = hasFocusedTest(suite);
  }

  const beforeAllHooks = suite.hooks.filter(h => h.type === 'beforeAll');
  const afterAllHooks = suite.hooks.filter(h => h.type === 'afterAll');
  const suiteBeforeEach = suite.hooks.filter(h => h.type === 'beforeEach').map(h => h.fn);
  const suiteAfterEach = suite.hooks.filter(h => h.type === 'afterEach').map(h => h.fn);

  // Inherited hooks run before this suite's own hooks; afterEach is reversed.
  const allBeforeEach = [...inheritedBeforeEach, ...suiteBeforeEach];
  const allAfterEach = [...suiteAfterEach, ...inheritedAfterEach];

  for (const hook of beforeAllHooks) await hook.fn();

  let i = 0;
  while (i < suite.tests.length) {
    const t = suite.tests[i];

    // Already marked skipped at collection time, or filtered out by .only focus.
    if (t.status === 'skipped' || (anyFocused && !t.focused)) {
      t.status = 'skipped';
      for (const r of reporters) await r.onTestSkip?.(t);
      i++;
      continue;
    }

    // Grep filter: skip tests whose name doesn't match the pattern.
    if (options.grepPattern !== undefined && !options.grepPattern.test(t.name)) {
      t.status = 'skipped';
      for (const r of reporters) await r.onTestSkip?.(t);
      i++;
      continue;
    }

    if (t.concurrent) {
      const batch: Test[] = [t];
      let j = i + 1;
      while (j < suite.tests.length && suite.tests[j].concurrent) {
        const next = suite.tests[j];
        const isSkippable =
          next.status === 'skipped' ||
          (anyFocused && !next.focused) ||
          (options.grepPattern !== undefined && !options.grepPattern.test(next.name));
        if (isSkippable) {
          // Mark and report the skipped test, but keep collecting the remaining concurrent tests.
          next.status = 'skipped';
          for (const r of reporters) await r.onTestSkip?.(next);
          j++;
          continue;
        }
        batch.push(next);
        j++;
      }
      // allSettled ensures every test in the batch runs to completion and is
      // reported, even if an earlier test in the same batch fails or times out.
      // executeTest never rejects — it captures errors into test.status itself.
      await Promise.allSettled(
        batch.map(bt => executeTest(bt, allBeforeEach, allAfterEach, reporters, defaultTimeoutMs)),
      );
      i = j;
    } else {
      await executeTest(t, allBeforeEach, allAfterEach, reporters, defaultTimeoutMs);
      i++;
    }
  }

  for (const child of suite.childSuites) {
    await runSuite(child, reporters, defaultTimeoutMs, false, allBeforeEach, allAfterEach, anyFocused, options);
  }

  for (const hook of afterAllHooks) {
    try {
      await hook.fn();
    } catch (hookErr) {
      const hookError = hookErr instanceof Error ? hookErr : new Error(String(hookErr));
      suite.afterAllErrors.push({ hookType: 'afterAll', error: hookError });
      for (const r of reporters) await r.onAfterAllError?.(suite, hookError);
    }
  }

  if (isRoot) {
    for (const r of reporters) await r.onRunComplete?.(suite);
  }
}
