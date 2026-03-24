import type { AoideConfig } from '../utils/config.js';
import type { Reporter } from './base.js';
import { TerminalReporter } from './terminal.js';
import { JSONReporter } from './json.js';

export function buildReporters(config: AoideConfig): Reporter[] {
  const reporters: Reporter[] = [];
  for (const name of config.reporters ?? ['terminal']) {
    if (name === 'terminal') {
      reporters.push(new TerminalReporter());
    } else if (name === 'json') {
      reporters.push(new JSONReporter(config.jsonReporterOutputPath));
    } else {
      console.warn(`[aoide] Unknown reporter: "${name}". Supported: terminal, json`);
    }
  }
  if (reporters.length === 0) reporters.push(new TerminalReporter());
  return reporters;
}
