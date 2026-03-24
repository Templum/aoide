import { defineConfig } from 'tsup';

const sharedEntry = {
  index: 'src/index.ts',
  'cli/index': 'src/cli/index.ts',
  'providers/openai': 'src/providers/openai.ts',
  'providers/ollama': 'src/providers/ollama.ts',
  'providers/lmstudio': 'src/providers/lmstudio.ts',
  'providers/anthropic': 'src/providers/anthropic.ts',
};

export default defineConfig([
  // ESM build
  {
    entry: sharedEntry,
    format: ['esm'],
    outDir: 'dist/esm',
    dts: true,
    splitting: true,
    sourcemap: false,
    clean: true,
    target: 'es2023',
    outExtension: () => ({ js: '.js' }),
    // Bundle pricing.json inline — removes reliance on the copy-assets script.
    loader: { '.json': 'copy' },
  },
  // CJS build
  {
    entry: sharedEntry,
    format: ['cjs'],
    outDir: 'dist/cjs',
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: true,
    target: 'es2023',
    outExtension: () => ({ js: '.cjs' }),
    loader: { '.json': 'copy' },
  },
]);
