export function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function isString(val: unknown): val is string {
  return typeof val === 'string';
}

export function isNumber(val: unknown): val is number {
  return typeof val === 'number';
}
