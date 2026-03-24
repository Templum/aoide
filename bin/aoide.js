#!/usr/bin/env node

try {
  process.loadEnvFile();
} catch {
  // .env file not found — that's fine
}

// When published to npm, the compiled dist/ is the only thing available.
// In local development (no dist/), fall back to tsx for on-the-fly compilation.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, '../dist/esm/cli/index.js');

let runCLI;

if (existsSync(distEntry)) {
  ({ runCLI } = await import(distEntry));
} else {
  // Development fallback: requires tsx to be installed
  try {
    ({ runCLI } = await import('../src/cli/index.ts'));
  } catch {
    console.error(
      'Error: Promptest CLI could not be loaded.\n' +
      '  - If running from a published package, the build may be corrupted. Try reinstalling.\n' +
      '  - If running from source, build first with: npm run build\n' +
      '  - Or install tsx for on-the-fly compilation: npm install -D tsx',
    );
    process.exit(1);
  }
}

runCLI(process.argv.slice(2)).catch(err => {
  console.error(err);
  process.exit(1);
});
