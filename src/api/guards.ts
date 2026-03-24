import { isObject, isString, isNumber } from '../utils/guards.js';
import type { JudgeResult } from './types.js';

export function isJudgeResult(val: unknown): val is JudgeResult {
  return (
    isObject(val) &&
    isNumber(val['score']) &&
    isString(val['reasoning'])
  );
}
