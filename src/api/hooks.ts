import { rootSuite, type Suite, type Fn } from '../core/ast.js';
import { collectionContext } from '../core/context.js';
import type { ModelTarget } from '../providers/types.js';

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

function describeFn(name: string, fn: () => void): void {
  const parentSuite = collectionContext.getStore() ?? rootSuite;
  const childSuite = parentSuite.addChildSuite(name);
  collectionContext.run(childSuite, fn);
}

describeFn.skip = (name: string, fn: () => void): void => {
  const parentSuite = collectionContext.getStore() ?? rootSuite;
  const childSuite = parentSuite.addChildSuite(name);
  collectionContext.run(childSuite, fn);
  // Mark every registered test in this suite (and descendants) as skipped.
  markSuiteSkipped(childSuite);
};

describeFn.only = (name: string, fn: () => void): void => {
  const parentSuite = collectionContext.getStore() ?? rootSuite;
  const childSuite = parentSuite.addChildSuite(name);
  collectionContext.run(childSuite, fn);
  // Mark every registered test in this suite (and descendants) as focused.
  markSuiteFocused(childSuite);
};

export const describe: typeof describeFn & {
  skip: typeof describeFn.skip;
  only: typeof describeFn.only;
} = describeFn;

// ---------------------------------------------------------------------------
// it / test
// ---------------------------------------------------------------------------

function itFn(name: string, fn: Fn, options?: { timeout?: number }): void {
  // Fall back to rootSuite when called outside a describe block (top-level tests).
  const suite = collectionContext.getStore() ?? rootSuite;
  suite.addTest(name, fn, options);
}

itFn.skip = (name: string, fn: Fn): void => {
  const suite = collectionContext.getStore() ?? rootSuite;
  const test = suite.addTest(name, fn);
  test.status = 'skipped';
};

itFn.only = (name: string, fn: Fn, options?: { timeout?: number }): void => {
  const suite = collectionContext.getStore() ?? rootSuite;
  const test = suite.addTest(name, fn, options);
  test.focused = true;
};

/**
 * Sanitises a provider or model name for use inside a test name suffix.
 * Replaces characters that break test name parsing or terminal output
 * (`[`, `]`, newlines, tabs) with safe equivalents. The original values
 * are unaffected and still used for dispatch.
 */
function sanitizeForTestName(value: string): string {
  return value
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

itFn.eachModel =
  (targets: ModelTarget[]) =>
  (name: string, fn: (target: ModelTarget) => Promise<void>): void => {
    const suite = collectionContext.getStore() ?? rootSuite;
    // Register all model tests up front so the runner can dispatch them concurrently.
    // Note: local providers (id prefix "local:") are automatically rate-limited to
    // 1 concurrent request by the Dispatcher — no extra configuration needed.
    for (const target of targets) {
      const safeProvider = sanitizeForTestName(target.provider);
      const safeModel = sanitizeForTestName(target.model);
      const testName = `${name} [${safeProvider}:${safeModel}]`;
      const test = suite.addTest(testName, () => fn(target));
      test.concurrent = true;
    }
  };

export const it: typeof itFn & {
  skip: typeof itFn.skip;
  only: typeof itFn.only;
  eachModel: typeof itFn.eachModel;
} = itFn;

export const test = it;

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

export function beforeAll(fn: Fn): void {
  const suite = collectionContext.getStore() ?? rootSuite;
  suite.addHook('beforeAll', fn);
}

export function afterAll(fn: Fn): void {
  const suite = collectionContext.getStore() ?? rootSuite;
  suite.addHook('afterAll', fn);
}

export function beforeEach(fn: Fn): void {
  const suite = collectionContext.getStore() ?? rootSuite;
  suite.addHook('beforeEach', fn);
}

export function afterEach(fn: Fn): void {
  const suite = collectionContext.getStore() ?? rootSuite;
  suite.addHook('afterEach', fn);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markSuiteSkipped(suite: Suite): void {
  for (const t of suite.tests) t.status = 'skipped';
  for (const child of suite.childSuites) markSuiteSkipped(child);
}

function markSuiteFocused(suite: Suite): void {
  for (const t of suite.tests) t.focused = true;
  for (const child of suite.childSuites) markSuiteFocused(child);
}
