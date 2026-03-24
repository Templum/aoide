import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Suite, Test } from '../core/ast.js';
import type { Reporter } from './base.js';
import { TelemetryTracker } from '../telemetry/tracker.js';

interface TestRecord {
  name: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  durationMs: number;
  telemetry: {
    appTokens: number;
    evalTokens: number;
    appCost: number;
    evalCost: number;
    cachedRequests: number;
  };
  error?: {
    message: string;
    stack?: string;
  };
}

interface SuiteRecord {
  name: string;
  tests: TestRecord[];
  childSuites: SuiteRecord[];
  afterAllErrors?: Array<{ message: string; stack?: string }>;
}

interface JSONReportOutput {
  timestamp: string;
  suites: SuiteRecord[];
  summary: {
    totalSuites: number;
    totalTests: number;
    passed: number;
    failed: number;
    durationMs: number;
    telemetry: {
      appTokens: number;
      evalTokens: number;
      appCost: number;
      evalCost: number;
      cachedRequests: number;
    };
  };
}

function testToRecord(test: Test): TestRecord {
  const record: TestRecord = {
    name: test.name,
    status: test.status,
    durationMs: test.durationMs,
    telemetry: { ...test.telemetry },
  };
  if (test.error) {
    record.error = {
      message: test.error.message,
      stack: test.error.stack,
    };
  }
  return record;
}

function suiteToRecord(suite: Suite): SuiteRecord {
  const record: SuiteRecord = {
    name: suite.name,
    tests: suite.tests.map(testToRecord),
    childSuites: suite.childSuites.map(suiteToRecord),
  };
  if (suite.afterAllErrors.length > 0) {
    record.afterAllErrors = suite.afterAllErrors.map(({ error }) => ({
      message: error.message,
      stack: error.stack,
    }));
  }
  return record;
}

function collectAllTests(suite: Suite): Test[] {
  return [
    ...suite.tests,
    ...suite.childSuites.flatMap(collectAllTests),
  ];
}

export class JSONReporter implements Reporter {
  private startMs = 0;
  private readonly outputPath: string;

  constructor(outputPath = 'aoide-results.json') {
    this.outputPath = outputPath;
  }

  onRunStart(_suite: Suite): void {
    this.startMs = Date.now();
  }

  onRunComplete(rootSuite: Suite): void {
    const allTests = collectAllTests(rootSuite);
    const passed = allTests.filter(t => t.status === 'passed').length;
    const failed = allTests.filter(t => t.status === 'failed').length;
    const durationMs = Date.now() - this.startMs;

    const telemetry = allTests.reduce(
      (acc, test) => ({
        appTokens: acc.appTokens + test.telemetry.appTokens,
        evalTokens: acc.evalTokens + test.telemetry.evalTokens,
        appCost: acc.appCost + test.telemetry.appCost,
        evalCost: acc.evalCost + test.telemetry.evalCost,
        cachedRequests: acc.cachedRequests + test.telemetry.cachedRequests,
      }),
      { appTokens: 0, evalTokens: 0, appCost: 0, evalCost: 0, cachedRequests: 0 },
    );

    const suites: SuiteRecord[] = rootSuite.childSuites.map(suiteToRecord);
    if (rootSuite.tests.length > 0) {
      suites.unshift(suiteToRecord(rootSuite));
    }

    const output: JSONReportOutput = {
      timestamp: new Date().toISOString(),
      suites,
      summary: {
        totalSuites: suites.length,
        totalTests: allTests.length,
        passed,
        failed,
        durationMs,
        telemetry,
      },
    };

    const absolutePath = resolve(process.cwd(), this.outputPath);
    const tmpPath = `${absolutePath}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf8');
      renameSync(tmpPath, absolutePath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    }
    console.log(`Test results written to ${this.outputPath}`);
  }
}
