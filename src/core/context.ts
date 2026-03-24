import { AsyncLocalStorage } from 'node:async_hooks';
import type { Suite, Test } from './ast.js';

export const collectionContext = new AsyncLocalStorage<Suite>();
export const executionContext = new AsyncLocalStorage<Test>();

export function getCurrentTest(): Test {
  const test = executionContext.getStore();
  if (test === undefined) {
    throw new Error(
      'getCurrentTest() called outside of a running test. ' +
      'Make sure you are calling it inside an `it` callback.',
    );
  }
  return test;
}
