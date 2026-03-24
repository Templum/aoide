export type HookType = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach';
export type Fn = () => void | Promise<void>;

export class Hook {
  constructor(
    public readonly type: HookType,
    public readonly fn: Fn,
  ) {}
}

export interface JudgeResult {
  criteria: string;
  score: number;
  reasoning: string;
}

export class Test {
  status: 'pending' | 'passed' | 'failed' | 'skipped' = 'pending';
  error?: Error;
  telemetry = { appTokens: 0, evalTokens: 0, appCost: 0, evalCost: 0, cachedRequests: 0 };
  judgeResults: JudgeResult[] = [];
  durationMs = 0;
  concurrent = false;
  focused = false;
  timeoutMs: number | undefined;
  /**
   * Tracks in-flight async assertions (toPassLLMJudge, toBeSemanticallySimilarTo, toHaveTone).
   * If any promises remain in this set when the test body resolves, the caller forgot `await`.
   */
  readonly pendingAssertions = new Set<Promise<unknown>>();

  constructor(
    public readonly name: string,
    public readonly fn: Fn,
    public readonly parent: Suite,
    timeoutMs?: number,
  ) {
    this.timeoutMs = timeoutMs;
  }
}

export class Suite {
  readonly childSuites: Suite[] = [];
  readonly tests: Test[] = [];
  readonly hooks: Hook[] = [];
  readonly afterAllErrors: Array<{ hookType: HookType; error: Error }> = [];

  constructor(public readonly name: string) {}

  addTest(name: string, fn: Fn, options?: { timeout?: number }): Test {
    const test = new Test(name, fn, this, options?.timeout);
    this.tests.push(test);
    return test;
  }

  addHook(type: HookType, fn: Fn): void {
    this.hooks.push(new Hook(type, fn));
  }

  addChildSuite(name: string): Suite {
    const suite = new Suite(name);
    this.childSuites.push(suite);
    return suite;
  }

  reset(): void {
    this.childSuites.length = 0;
    this.tests.length = 0;
    this.hooks.length = 0;
    this.afterAllErrors.length = 0;
  }

  /**
   * Moves all child suites, top-level tests, and hooks from `other` into this
   * suite. Used by the CLI to merge per-file roots into a single aggregate root
   * before firing `onRunComplete` once across all files.
   */
  adoptFrom(other: Suite): void {
    for (const child of other.childSuites) this.childSuites.push(child);
    for (const test of other.tests) this.tests.push(test);
    for (const hook of other.hooks) this.hooks.push(hook);
  }
}

export const rootSuite = new Suite('<root>');

export function resetRootSuite(): void {
  rootSuite.reset();
}
