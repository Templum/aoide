import { parseArgs } from 'node:util';

export interface CliFlags {
  updateSnapshots: boolean;
  noCache: boolean;
  maxWorkers: number | undefined;
  timeout: number | undefined;
  reporters: string[] | undefined;
  config: string | undefined;
  testMatch: string | undefined;
  grep: string | undefined;
  jsonOutput: string | undefined;
  maxRetries: number | undefined;
  watch: boolean;
  help: boolean;
}

export const HELP_TEXT = `
aoide — LLM testing framework

USAGE
  aoide [options]
  aoide init [--force]

COMMANDS
  init          Scaffold aoide.config.ts and examples/basic.promptest.ts
    --force     Overwrite existing files

OPTIONS
  -h, --help                  Show this help message
  -w, --watch                 Re-run tests on file change
  -u, --update-snapshots      Update cached prompt snapshots
      --no-cache              Disable snapshot caching entirely
  -c, --config <path>         Path to config file (default: aoide.config.ts)
      --test-match <glob>     Override test file glob pattern
      --grep <pattern>        Only run tests whose name matches the regex pattern
      --reporter <name>       Reporter to use: terminal, json (repeatable)
      --json-output <path>    Output path for JSON reporter (default: aoide-results.json)
      --max-workers <n>       Max concurrent requests per provider
      --timeout <ms>          Override default test timeout in milliseconds (default: 30000)
      --max-retries <n>       Max retries on transient API errors (default: 3)

EXAMPLES
  aoide
  aoide --watch
  aoide --grep "summarisation"
  aoide --reporter terminal --reporter json
  aoide --no-cache
  aoide --timeout 60000
  aoide init
`.trim();

/**
 * Parses a CLI flag value as a non-negative integer.
 * Exits with a clear error message if the value is not a valid integer.
 */
function parsePositiveInt(raw: string, flagName: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Error: --${flagName} must be a non-negative integer, got "${raw}".`);
    process.exit(1);
  }
  return n;
}

let parsedFlags: CliFlags | null = null;

export function parseCliArgs(args: string[]): CliFlags {
  const { values } = parseArgs({
    args,
    strict: false,
    options: {
      'update-snapshots': { type: 'boolean', short: 'u' },
      'no-cache': { type: 'boolean' },
      'max-workers': { type: 'string' },
      'timeout': { type: 'string' },
      'reporter': { type: 'string', multiple: true },
      'config': { type: 'string', short: 'c' },
      'test-match': { type: 'string' },
      'grep': { type: 'string' },
      'json-output': { type: 'string' },
      'max-retries': { type: 'string' },
      'watch': { type: 'boolean', short: 'w' },
      'help': { type: 'boolean', short: 'h' },
    },
  });

  const maxWorkersRaw = values['max-workers'];
  const maxWorkers =
    typeof maxWorkersRaw === 'string' && maxWorkersRaw.length > 0
      ? parsePositiveInt(maxWorkersRaw, 'max-workers')
      : undefined;

  const timeoutRaw = values['timeout'];
  const timeout =
    typeof timeoutRaw === 'string' && timeoutRaw.length > 0
      ? parsePositiveInt(timeoutRaw, 'timeout')
      : undefined;

  const maxRetriesRaw = values['max-retries'];
  const maxRetries =
    typeof maxRetriesRaw === 'string' && maxRetriesRaw.length > 0
      ? parsePositiveInt(maxRetriesRaw, 'max-retries')
      : undefined;

  const grepRaw = values['grep'];
  let grep: string | undefined;
  if (typeof grepRaw === 'string' && grepRaw.length > 0) {
    // Validate the pattern early so the error is emitted before any files load.
    try {
      new RegExp(grepRaw);
    } catch {
      console.error(`Error: --grep "${grepRaw}" is not a valid regular expression.`);
      process.exit(1);
    }
    grep = grepRaw;
  }

  const jsonOutputRaw = values['json-output'];
  const jsonOutput =
    typeof jsonOutputRaw === 'string' && jsonOutputRaw.length > 0 ? jsonOutputRaw : undefined;

  const reporterRaw = values['reporter'];
  const reporters =
    Array.isArray(reporterRaw) && reporterRaw.length > 0
      ? (reporterRaw as string[])
      : undefined;

  const configRaw = values['config'];
  const config = typeof configRaw === 'string' && configRaw.length > 0 ? configRaw : undefined;

  const testMatchRaw = values['test-match'];
  const testMatch =
    typeof testMatchRaw === 'string' && testMatchRaw.length > 0 ? testMatchRaw : undefined;

  parsedFlags = {
    updateSnapshots: values['update-snapshots'] === true,
    noCache: values['no-cache'] === true,
    maxWorkers,
    timeout,
    maxRetries,
    reporters,
    config,
    testMatch,
    grep,
    jsonOutput,
    watch: values['watch'] === true,
    help: values['help'] === true,
  };

  return parsedFlags;
}

export function getCliFlags(): CliFlags {
  if (parsedFlags === null) {
    return {
      updateSnapshots: false,
      noCache: false,
      maxWorkers: undefined,
      timeout: undefined,
      maxRetries: undefined,
      reporters: undefined,
      config: undefined,
      testMatch: undefined,
      grep: undefined,
      jsonOutput: undefined,
      watch: false,
      help: false,
    };
  }
  return parsedFlags;
}
