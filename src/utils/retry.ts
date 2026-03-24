/**
 * Node.js error codes that represent transient network conditions safe to retry.
 * Using a Set provides O(1) lookup and makes additions self-documenting.
 */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',    // connection reset by peer
  'ETIMEDOUT',     // connection or request timed out
  'ECONNREFUSED',  // remote refused the connection
  'ENOTFOUND',     // DNS resolution failure (transient under flaky network)
  'EHOSTUNREACH',  // no route to host
  'ECONNABORTED',  // connection aborted mid-flight
]);

/**
 * Maximum delay between retries in milliseconds.
 * Without this cap, high maxRetries values produce unreasonably long delays
 * (e.g. maxRetries=10 + baseMs=100 → ceiling of ~51 s on the last attempt).
 */
const MAX_BACKOFF_MS = 30_000;

/**
 * Determines whether an error represents a transient API failure that is safe
 * to retry (rate limits, temporary unavailability, network blips).
 */
function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    // Network-level errors identified by Node.js errno codes.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== undefined && TRANSIENT_CODES.has(code)) return true;

    // HTTP status codes embedded in ApiError or plain Error messages.
    const msg = err.message;
    if (/\b(429|502|503|504)\b/.test(msg)) return true;
  }
  return false;
}

/**
 * Executes `fn`, retrying up to `maxRetries` times on transient errors.
 * Uses exponential back-off with full jitter: delay = random(0, min(baseMs * 2^attempt, MAX_BACKOFF_MS)).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseBackoffMs = 100,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isTransient(err)) {
        throw err;
      }
      // Full-jitter exponential back-off, capped at MAX_BACKOFF_MS to keep
      // delays predictable when maxRetries is set to a high value.
      const ceiling = Math.min(baseBackoffMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
      const delay = Math.floor(Math.random() * ceiling);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
