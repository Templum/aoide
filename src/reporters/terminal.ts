import type { Suite, Test } from '../core/ast.js';
import type { Reporter } from './base.js';
import { TelemetryTracker } from '../telemetry/tracker.js';

// Tracks which suite headers have already been printed during streaming output.
const printedSuites = new WeakSet<Suite>();

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY === true;

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

function fmt(color: string, text: string): string {
  return `${color}${text}${c.reset}`;
}

function fmtCost(dollars: number): string {
  return `[$${dollars.toFixed(4)}]`;
}

function fmtDuration(ms: number): string {
  return `(${ms}ms)`;
}

// ---------------------------------------------------------------------------
// Suite traversal helpers
// ---------------------------------------------------------------------------
function collectTests(suite: Suite): Test[] {
  return [
    ...suite.tests,
    ...suite.childSuites.flatMap(collectTests),
  ];
}

// Collect only top-level named suites (direct children of root), each with
// their flattened test list — mirrors the SPEC file-per-suite grouping.
interface SuiteGroup {
  suite: Suite;
  tests: Test[];
}

function collectGroups(root: Suite): SuiteGroup[] {
  const groups: SuiteGroup[] = root.childSuites.map(s => ({
    suite: s,
    tests: collectTests(s),
  }));
  if (root.tests.length > 0) {
    groups.unshift({ suite: root, tests: root.tests });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Per-test line builder
// ---------------------------------------------------------------------------
function testLine(test: Test): string {
  if (test.status === 'skipped') {
    const symbol = isTTY ? '◯' : '-';
    return `    ${fmt(c.dim, symbol)} ${fmt(c.dim, test.name)} ${fmt(c.dim, '(skipped)')}`;
  }

  const appWasCached = test.telemetry.cachedRequests > 0;
  const totalCost = test.telemetry.appCost + test.telemetry.evalCost;

  const badge = appWasCached
    ? `${fmt(c.cyan, '[cached]')} ${fmt(c.dim, fmtCost(test.telemetry.evalCost))}`
    : fmt(c.dim, fmtCost(totalCost));

  if (test.status === 'passed') {
    const symbol = isTTY ? '✓' : '+';
    return (
      `    ${fmt(c.green, symbol)} ${test.name} ` +
      `${fmt(c.dim, fmtDuration(test.durationMs))} ${badge}`
    );
  }

  const symbol = isTTY ? '✕' : 'x';
  return (
    `    ${fmt(c.red, symbol)} ${test.name} ` +
    `${fmt(c.dim, fmtDuration(test.durationMs))} ${badge}`
  );
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------
export class TerminalReporter implements Reporter {
  private readonly failures: Array<{ test: Test; error: Error }> = [];
  private readonly afterAllFailures: Array<{ suite: Suite; error: Error }> = [];
  private suiteStartMs = 0;

  onRunStart(_suite: Suite): void {
    this.suiteStartMs = Date.now();
    // Clear the suite-header tracking set so re-runs in watch mode start fresh.
    // (WeakSet entries are automatically collected, but we reset the reference.)
    // Note: printedSuites is module-level — nothing to clear here explicitly,
    // since suites are new objects on each run after resetRootSuite().
  }

  /**
   * Prints the suite name header the first time a test from that suite
   * completes (pass, fail, or skip). This ensures the header appears before
   * the first test result line without requiring a separate onSuiteStart hook.
   */
  private printSuiteHeaderIfNeeded(suite: Suite): void {
    if (!printedSuites.has(suite)) {
      printedSuites.add(suite);
      console.log(`  ${fmt(c.bold, suite.name)}`);
    }
  }

  onTestPass(test: Test): void {
    this.printSuiteHeaderIfNeeded(test.parent);
    console.log(testLine(test));
  }

  onTestFail(test: Test, error: Error): void {
    this.failures.push({ test, error });
    this.printSuiteHeaderIfNeeded(test.parent);
    console.log(testLine(test));
  }

  onTestSkip(test: Test): void {
    this.printSuiteHeaderIfNeeded(test.parent);
    console.log(testLine(test));
  }

  onAfterAllError(suite: Suite, error: Error): void {
    this.afterAllFailures.push({ suite, error });
  }

  onRunComplete(rootSuite: Suite): void {
    const separator = fmt(c.dim, '-'.repeat(81));
    const allTests = collectTests(rootSuite);
    const passed = allTests.filter(t => t.status === 'passed').length;
    const failed = allTests.filter(t => t.status === 'failed').length;
    const skipped = allTests.filter(t => t.status === 'skipped').length;
    const total = allTests.length;
    const totalMs = Date.now() - this.suiteStartMs;
    const hasFailed = failed > 0 || this.afterAllFailures.length > 0;

    const groups = collectGroups(rootSuite);

    // --- Failure detail blocks ---
    if (this.failures.length > 0 || this.afterAllFailures.length > 0) {
      console.log();
      for (const { test, error } of this.failures) {
        const fullName = `${test.parent.name} › ${test.name}`;
        console.log(`  ${fmt(c.bold + c.red, '●')} ${fmt(c.bold, fullName)}\n`);
        const lines = (error.stack ?? error.message).split('\n');
        for (const line of lines) {
          console.log(`    ${fmt(c.red, line)}`);
        }
        console.log();
      }
      for (const { suite, error } of this.afterAllFailures) {
        const label = `afterAll hook in "${suite.name}"`;
        console.log(`  ${fmt(c.bold + c.red, '●')} ${fmt(c.bold, label)}\n`);
        const lines = (error.stack ?? error.message).split('\n');
        for (const line of lines) {
          console.log(`    ${fmt(c.red, line)}`);
        }
        console.log();
      }
    }

    // --- PASS/FAIL header + summary counts ---
    console.log(separator);

    const fileLabel = hasFailed
      ? fmt(c.bold + c.red, 'FAIL')
      : fmt(c.bold + c.green, 'PASS');

    console.log(`${fileLabel}  (${totalMs}ms)`);

    const suiteWord = groups.length === 1 ? 'suite' : 'suites';
    const suiteSummary = hasFailed
      ? `${fmt(c.bold + c.red, `${groups.filter(g => g.tests.some(t => t.status === 'failed')).length} failed`)}, ${groups.length} total`
      : `${fmt(c.bold + c.green, `${groups.length} passed`)}, ${groups.length} total`;

    const skippedPart = skipped > 0 ? `, ${fmt(c.dim, `${skipped} skipped`)}` : '';
    const testSummary = hasFailed
      ? `${fmt(c.bold + c.red, `${failed} failed`)}, ${fmt(c.bold + c.green, `${passed} passed`)}${skippedPart}, ${total} total`
      : `${fmt(c.bold + c.green, `${passed} passed`)}${skippedPart}, ${total} total`;

    console.log(`Test ${suiteWord}: ${suiteSummary}`);
    console.log(`Tests:       ${testSummary}`);

    // --- Telemetry summary ---
    const telemetry = TelemetryTracker.getSummary();
    const totalCost = telemetry.appCost + telemetry.evalCost;

    const telemetryHeader = isTTY ? '📊 AI Telemetry Summary:' : 'AI Telemetry Summary:';
    console.log();
    console.log(fmt(c.bold + c.cyan, telemetryHeader));
    console.log(
      `  App Tokens:  ${fmt(c.white, telemetry.appTokens.toLocaleString().padEnd(7))} ` +
      `(Cost: ${fmt(c.yellow, `$${telemetry.appCost.toFixed(4)}`)})`,
    );
    console.log(
      `  Eval Tokens: ${fmt(c.white, telemetry.evalTokens.toLocaleString().padEnd(7))} ` +
      `(Cost: ${fmt(c.yellow, `$${telemetry.evalCost.toFixed(4)}`)})`,
    );
    console.log(
      `  Total Cost:  ${fmt(c.bold + c.yellow, `$${totalCost.toFixed(4)}`)}`,
    );
    if (telemetry.cachedRequests > 0) {
      console.log(
        `  ${fmt(c.cyan, `${telemetry.cachedRequests} cached request${telemetry.cachedRequests === 1 ? '' : 's'} — no network calls made`)}`,
      );
    }
    console.log(separator);
  }
}
