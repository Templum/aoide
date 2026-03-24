import { isObject, isString } from '../utils/guards.js';
import type { ModelResponse, ModelTarget } from './types.js';

export function isModelResponse(val: unknown): val is ModelResponse {
  return (
    isObject(val) &&
    isString(val['text']) &&
    isObject(val['metadata']) &&
    isObject(val['usage'])
  );
}

export function isModelTarget(val: unknown): val is ModelTarget {
  return (
    isObject(val) &&
    isString(val['provider']) &&
    isString(val['model'])
  );
}
