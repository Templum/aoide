import type { Suite, Test, HookType } from '../core/ast.js';

export interface Reporter {
  onRunStart?(suite: Suite): void | Promise<void>;
  onTestStart?(test: Test): void | Promise<void>;
  onTestPass?(test: Test): void | Promise<void>;
  onTestFail?(test: Test, error: Error): void | Promise<void>;
  onTestSkip?(test: Test): void | Promise<void>;
  /** Called when a beforeEach or afterEach hook throws. The test result is not changed. */
  onHookError?(hookType: HookType, test: Test, error: Error): void | Promise<void>;
  /** Called when an afterAll hook throws. Runs outside of any individual test context. */
  onAfterAllError?(suite: Suite, error: Error): void | Promise<void>;
  onRunComplete?(suite: Suite): void | Promise<void>;
}
