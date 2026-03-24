import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Suite, Test } from '../../../src/core/ast.js';
import { JSONReporter } from '../../../src/reporters/json.js';

// ---------------------------------------------------------------------------
// JSONReporter
// ---------------------------------------------------------------------------

vi.mock('node:fs');

describe('JSONReporter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a JSON file on onRunComplete', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const root = new Suite('<root>');
    const suite = root.addChildSuite('My Suite');
    const t = new Test('passes', async () => {}, suite);
    t.status = 'passed';
    t.durationMs = 100;
    suite.tests.push(t);

    const reporter = new JSONReporter('test-output.json');
    reporter.onRunStart(root);
    reporter.onRunComplete(root);

    expect(fs.writeFileSync).toHaveBeenCalledOnce();
    const [, raw] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    const output = JSON.parse(raw) as {
      summary: { passed: number; failed: number; totalTests: number };
      suites: Array<{ name: string; tests: Array<{ status: string }> }>;
    };
    expect(output.summary.passed).toBe(1);
    expect(output.summary.failed).toBe(0);
    expect(output.summary.totalTests).toBe(1);
    expect(output.suites[0].name).toBe('My Suite');
  });

  it('serialises skipped tests with status "skipped"', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t = new Test('skipped test', async () => {}, suite);
    t.status = 'skipped';
    suite.tests.push(t);

    const reporter = new JSONReporter();
    reporter.onRunStart(root);
    reporter.onRunComplete(root);

    const [, raw] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    const output = JSON.parse(raw) as {
      suites: Array<{ tests: Array<{ status: string }> }>;
    };
    expect(output.suites[0].tests[0].status).toBe('skipped');
  });

  it('includes failed test error message in output', async () => {
    const fs = await import('node:fs');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const root = new Suite('<root>');
    const suite = root.addChildSuite('Suite');
    const t = new Test('failing test', async () => {}, suite);
    t.status = 'failed';
    t.error = new Error('something went wrong');
    suite.tests.push(t);

    const reporter = new JSONReporter();
    reporter.onRunStart(root);
    reporter.onRunComplete(root);

    const [, raw] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
    const output = JSON.parse(raw) as {
      summary: { failed: number };
      suites: Array<{ tests: Array<{ error?: { message: string } }> }>;
    };
    expect(output.summary.failed).toBe(1);
    expect(output.suites[0].tests[0].error?.message).toBe('something went wrong');
  });
});
