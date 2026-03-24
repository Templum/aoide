/**
 * Directories excluded from test file discovery.
 * Covers common build output, toolchain caches, and coverage directories
 * in addition to node_modules so compiled files are never run as tests.
 */
export const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.next', '.nuxt',
  '.output', 'out', 'coverage', '.cache',
]);

/**
 * Returns a glob exclude function that skips any path whose segments include
 * one of the given directories.
 */
export function createExcludeFilter(
  excludedDirs: Set<string>,
): (p: string) => boolean {
  return (p: string) => p.split('/').some(segment => excludedDirs.has(segment));
}
