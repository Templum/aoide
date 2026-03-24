import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../../../src/cli/args.js';

describe('parseCliArgs', () => {
  it('returns safe defaults for empty args', () => {
    const flags = parseCliArgs([]);
    expect(flags.updateSnapshots).toBe(false);
    expect(flags.noCache).toBe(false);
    expect(flags.maxWorkers).toBeUndefined();
    expect(flags.reporters).toBeUndefined();
  });

  it('sets updateSnapshots via short flag -u', () => {
    const flags = parseCliArgs(['-u']);
    expect(flags.updateSnapshots).toBe(true);
  });

  it('sets updateSnapshots via --update-snapshots', () => {
    const flags = parseCliArgs(['--update-snapshots']);
    expect(flags.updateSnapshots).toBe(true);
  });

  it('sets noCache via --no-cache', () => {
    const flags = parseCliArgs(['--no-cache']);
    expect(flags.noCache).toBe(true);
  });

  it('parses --max-workers=5 to the number 5', () => {
    const flags = parseCliArgs(['--max-workers=5']);
    expect(flags.maxWorkers).toBe(5);
  });

  it('parses multiple --reporter flags into an array', () => {
    const flags = parseCliArgs(['--reporter=json', '--reporter=terminal']);
    expect(flags.reporters).toEqual(['json', 'terminal']);
  });
});
