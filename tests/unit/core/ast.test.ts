import { describe, it, expect, beforeEach } from 'vitest';
import { rootSuite, Suite, resetRootSuite } from '../../../src/core/ast.js';
import { describe as pdescribe, it as pit } from '../../../src/api/hooks.js';
import { getCurrentTest } from '../../../src/core/context.js';
import { runSuite } from '../../../src/core/runner.js';
import { collectionContext } from '../../../src/core/context.js';

// Reset rootSuite state before each vitest test
beforeEach(() => {
  resetRootSuite();
});

describe('AST construction and runner', () => {
  it('builds the suite tree and runs tests with execution context', async () => {
    let capturedTest: ReturnType<typeof getCurrentTest> | undefined;

    // Simulate a user calling our describe/it API
    collectionContext.run(rootSuite, () => {
      pdescribe('my suite', () => {
        pit('my test', async () => {
          capturedTest = getCurrentTest();
        });
      });
    });

    // Assert tree structure
    expect(rootSuite.childSuites).toHaveLength(1);
    const mySuite = rootSuite.childSuites[0];
    expect(mySuite.name).toBe('my suite');
    expect(mySuite.tests).toHaveLength(1);
    expect(mySuite.tests[0].name).toBe('my test');
    expect(mySuite.tests[0].status).toBe('pending');

    // Run and assert outcomes
    await runSuite(rootSuite, []);

    expect(mySuite.tests[0].status).toBe('passed');
    expect(capturedTest).toBe(mySuite.tests[0]);
  });
});
