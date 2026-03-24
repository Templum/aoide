import { describe, it, expect, vi } from 'vitest';
import { Suite, Test } from '../../../src/core/ast.js';
import { runSuite } from '../../../src/core/runner.js';
import type { Reporter } from '../../../src/reporters/base.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReporter(overrides: Partial<Reporter> = {}): Reporter {
  return {
    onRunStart: vi.fn(),
    onTestStart: vi.fn(),
    onTestPass: vi.fn(),
    onTestFail: vi.fn(),
    onTestSkip: vi.fn(),
    onHookError: vi.fn(),
    onRunComplete: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// anyFocused propagation
// ---------------------------------------------------------------------------

describe('runner — anyFocused propagation', () => {
  it('runs only focused tests in child suites when a sibling suite has a focused test', async () => {
    const root = new Suite('<root>');

    const suiteA = root.addChildSuite('Suite A');
    const focusedTest = suiteA.addTest('focused', async () => {});
    focusedTest.focused = true;

    const suiteB = root.addChildSuite('Suite B');
    const unfocusedTest = suiteB.addTest('not focused', async () => {});

    const reporter = makeReporter();
    await runSuite(root, [reporter]);

    expect(focusedTest.status).toBe('passed');
    // unfocusedTest should be skipped because anyFocused is true
    expect(unfocusedTest.status).toBe('skipped');
  });

  it('runs all tests when no test is focused', async () => {
    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t1 = suite.addTest('test 1', async () => {});
    const t2 = suite.addTest('test 2', async () => {});

    await runSuite(root);

    expect(t1.status).toBe('passed');
    expect(t2.status).toBe('passed');
  });

  it('skips tests in deeply nested suites when a focused test exists elsewhere', async () => {
    const root = new Suite('<root>');

    const parentA = root.addChildSuite('Parent A');
    const childA = parentA.addChildSuite('Child A');
    const deep = childA.addTest('deep focused', async () => {});
    deep.focused = true;

    const parentB = root.addChildSuite('Parent B');
    const unfocused = parentB.addTest('unfocused', async () => {});

    await runSuite(root);

    expect(deep.status).toBe('passed');
    expect(unfocused.status).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// afterEach error surfacing
// ---------------------------------------------------------------------------

describe('runner — afterEach error handling', () => {
  it('does not override test pass status when afterEach throws', async () => {
    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t = suite.addTest('test', async () => {});
    suite.addHook('afterEach', async () => { throw new Error('cleanup failed'); });

    const reporter = makeReporter();
    await runSuite(root, [reporter]);

    expect(t.status).toBe('passed');
    expect(reporter.onHookError).toHaveBeenCalledOnce();
    const [hookType, , err] = (reporter.onHookError as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Test, Error];
    expect(hookType).toBe('afterEach');
    expect(err.message).toBe('cleanup failed');
  });

  it('does not override test fail status when afterEach also throws', async () => {
    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t = suite.addTest('test', async () => { throw new Error('test failure'); });
    suite.addHook('afterEach', async () => { throw new Error('cleanup failed'); });

    const reporter = makeReporter();
    await runSuite(root, [reporter]);

    expect(t.status).toBe('failed');
    expect(t.error?.message).toBe('test failure');
    expect(reporter.onHookError).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// afterAll error handling
// ---------------------------------------------------------------------------

describe('runner — afterAll error handling', () => {
  it('records the error in suite.afterAllErrors and does not mark tests as failed', async () => {
    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t = suite.addTest('test', async () => {});
    suite.addHook('afterAll', async () => { throw new Error('afterAll boom'); });

    await runSuite(root);

    expect(t.status).toBe('passed');
    expect(suite.afterAllErrors).toHaveLength(1);
    expect(suite.afterAllErrors[0].error.message).toContain('afterAll boom');
  });
});
