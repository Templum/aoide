# aoide

> *Aoide* (Ancient Greek: Ἀοιδή, "the singing one") was one of the three original Muses in Greek mythology — the Muse of song and vocal expression. Before words are written they must first be spoken, and before a prompt reaches a model it must be tested. `aoide` is that test.

A TypeScript testing framework for LLM-powered applications. Write tests that send real prompts to language models and assert on their responses — including deterministic checks, JSON schema validation, and LLM-as-judge evaluations.

```ts
import { describe, it, expect, runPrompt, registerProvider, beforeAll } from 'aoide';
import { OpenAIProvider } from 'aoide/providers/openai';

beforeAll(() => {
  registerProvider(new OpenAIProvider('openai', process.env.OPENAI_API_KEY!));
});

describe('Customer support bot', () => {
  it('responds empathetically to a complaint', async () => {
    const response = await runPrompt(
      { provider: 'openai', model: 'gpt-4o-mini' },
      { messages: [{ role: 'user', content: 'My order is late and I am frustrated.' }] },
    );

    await expect(response).toPassLLMJudge({
      criteria: 'The response acknowledges the frustration and offers to help.',
      threshold: 0.8,
    });
  });
});
```

---

## Features

- **Familiar API** — `describe`, `it`, `beforeAll/Each`, `afterAll/Each`, `expect`
- **Built-in assertions** — string, numeric, regex, JSON Schema, token/cost budgets, and `.not` negation
- **LLM evaluators** — judge scoring, semantic similarity, tone checking, factual consistency, persona matching, topic avoidance, and structural equivalence
- **Prompt caching** — dual SHA-256 snapshot cache (app + eval) so re-runs are free; `--update-snapshots` refreshes app prompts without wiping eval cache
- **Telemetry** — per-test and global token counts and cost estimates
- **Multi-provider** — OpenAI, Anthropic, Ollama, LM Studio, or any custom provider
- **Concurrency** — configurable per-provider; local providers default to 1 to protect host resources
- **Retry policy** — automatic exponential back-off on transient API errors (429, 502/503/504, DNS/network blips)
- **Watch mode** — re-run tests on file change; new test files are discovered automatically
- **Programmatic API** — run tests from Node scripts or CI pipelines without shelling out

---

## Built with AI

> **Note:** `aoide` was developed with significant assistance from Large Language Models. This library is a product of AI-assisted engineering, leveraging advanced models to help write its code, tests, and documentation.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Test File Format](#test-file-format)
  - [Focused and Skipped Tests](#focused-and-skipped-tests)
  - [Per-Model Tests](#per-model-tests)
- [Providers](#providers)
- [Assertions API](#assertions-api)
- [Actions](#actions)
  - [runPrompt](#runprompt)
  - [runTournament](#runtournament)
- [Programmatic API](#programmatic-api)
- [CLI Reference](#cli-reference)
- [Snapshot Caching](#snapshot-caching)
- [Retry Policy](#retry-policy)
- [Telemetry](#telemetry)
- [Concurrency](#concurrency)
- [Common Pitfalls](#common-pitfalls)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install --save-dev aoide
```

**Requirements:** Node.js ≥ 22

> **Note:** `aoide` is currently in active pre-release development (`0.x`). The public API is stable but minor breaking changes may occur before `1.0`. Pin your version in `package.json` if you need stability across installs.

---

## Quick Start

```bash
npx aoide init
```

This creates `aoide.config.ts` and `examples/basic.promptest.ts`. Edit the config to add your judge target and API key, then run:

```bash
npx aoide
```

---

## Configuration

Create `aoide.config.ts` in your project root:

```ts
import type { AoideConfig } from 'aoide';

const config: AoideConfig = {
  // LLM used to evaluate judge-based assertions
  judge: {
    target: { provider: 'openai', model: 'gpt-4o-mini' },
    temperature: 0.0,
    // systemPrompt: 'You are a strict evaluator. Be concise.',
  },

  // Embedder used for toBeSemanticallySimilarTo assertions (optional)
  // embedder: {
  //   target: { provider: 'openai', model: 'text-embedding-3-small' },
  // },

  // Glob patterns for test files (default: ['**/*.promptest.ts'])
  testMatch: ['**/*.promptest.ts'],

  // Reporters: 'terminal' (default), 'json'
  reporters: ['terminal', 'json'],

  // Output path for the JSON reporter (default: 'aoide-results.json')
  // jsonReporterOutputPath: 'results/aoide.json',

  // Per-test timeout in ms (default: 30 000)
  defaultTestTimeout: 60_000,

  // Retry policy for transient API errors (optional)
  retryPolicy: {
    maxRetries: 3,    // default: 3
    backoffMs: 100,   // base back-off; actual delay uses full-jitter exponential back-off
  },

  // Override pricing for cost tracking (optional)
  // pricingOverrides: {
  //   'openai:gpt-4o': { input: 2.5, output: 10 }, // per 1M tokens in USD
  // },
};

export default config;
```

### Config Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `judge.target` | `ModelTarget` | — | Model to use as judge for LLM assertions |
| `judge.temperature` | `number` | — | Judge model temperature |
| `judge.systemPrompt` | `string` | — | Optional custom system prompt for the judge |
| `embedder.target` | `ModelTarget` | — | Model to use for `toBeSemanticallySimilarTo` assertions |
| `testMatch` | `string[]` | `['**/*.promptest.ts']` | Glob patterns for test files |
| `reporters` | `string[]` | `['terminal']` | Active reporters (`terminal`, `json`); unknown names log a warning and fall back to `terminal` |
| `jsonReporterOutputPath` | `string` | `'aoide-results.json'` | Output file path for the JSON reporter |
| `defaultTestTimeout` | `number` | `30000` | Per-test timeout in milliseconds (must be a positive number > 0) |
| `retryPolicy.maxRetries` | `number` | `3` | Max retry attempts on transient API errors |
| `retryPolicy.backoffMs` | `number` | `100` | Base back-off in ms (full-jitter exponential) |
| `pricingOverrides` | `Record<string, { input: number; output: number }>` | — | Override token pricing for cost estimates (USD per 1M tokens) |

---

## Test File Format

Test files match `**/*.promptest.ts` by default.

```ts
import {
  describe, it, expect,
  runPrompt, runTournament,
  registerProvider, setupJudge, setupEmbedder,
  beforeAll, afterAll, beforeEach, afterEach,
} from 'aoide';
import { OpenAIProvider } from 'aoide/providers/openai';

beforeAll(() => {
  registerProvider(new OpenAIProvider('openai', process.env.OPENAI_API_KEY!));
});

describe('My suite', () => {
  it('test name', async () => {
    const response = await runPrompt(
      { provider: 'openai', model: 'gpt-4o-mini' },
      { messages: [{ role: 'user', content: 'Say hello.' }] },
    );
    expect(response).toContain('hello');
  });
});

// Top-level tests (no describe block) are supported:
it('top-level test', async () => {
  // ...
});
```

### Focused and Skipped Tests

```ts
it.only('only this runs', async () => { /* ... */ });
it.skip('skip this', async () => { /* ... */ });
describe.only('only this suite', () => { /* ... */ });
describe.skip('skip this suite', () => { /* ... */ });
```

If any `.only` is present, all other tests in that **file** are automatically skipped. Focus is scoped per file — a `.only` in one file does not affect other files.

### Per-Model Tests

Run the same test against multiple models concurrently:

```ts
const targets = [
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'openai', model: 'gpt-4o' },
];

it.eachModel(targets)('summarises correctly', async (target) => {
  const response = await runPrompt(target, { messages: [...] });
  expect(response).toContain('summary');
});
```

Each model becomes a separate test named `summarises correctly [openai:gpt-4o-mini]`, `summarises correctly [openai:gpt-4o]`, and so on. All run concurrently within their provider's concurrency limit.

> **Note:** Provider and model names are sanitised in the generated test name (brackets replaced, whitespace normalised). The original values are always used for dispatch.
> Local providers (id prefix `local:`) are automatically limited to 1 concurrent request. Remote providers default to 5. Use `--max-workers` or `setProviderConcurrency()` to override.

---

## Providers

### OpenAI

```ts
import { OpenAIProvider } from 'aoide/providers/openai';
// also available as: import { OpenAIProvider } from 'aoide';

registerProvider(new OpenAIProvider('openai', process.env.OPENAI_API_KEY!));

// Custom base URL (e.g. Azure OpenAI):
registerProvider(new OpenAIProvider('azure', process.env.AZURE_KEY!, 'https://...'));
```

Supports embeddings (`toBeSemanticallySimilarTo`).

### Anthropic

```ts
import { AnthropicProvider } from 'aoide';

registerProvider(new AnthropicProvider('anthropic', process.env.ANTHROPIC_API_KEY!));

// Custom API version (default: '2024-06-01'):
registerProvider(new AnthropicProvider('anthropic', process.env.ANTHROPIC_API_KEY!, 'https://api.anthropic.com/v1', '2024-06-01'));

// Custom default max_tokens (default: 4096). Anthropic requires this field in
// every request. Raise it if your tests need longer responses:
registerProvider(new AnthropicProvider('anthropic', process.env.ANTHROPIC_API_KEY!, undefined, undefined, 8192));
```

> **Note:** Anthropic requires `max_tokens` in every API call. aoide defaults to `4096`, which is suitable for most test responses. Per-request overrides take precedence: `runPrompt(target, { maxTokens: 1024, ... })`.

### Ollama (local)

```ts
import { OllamaProvider } from 'aoide/providers/ollama';
// also available as: import { OllamaProvider } from 'aoide';

// Default id is 'local:ollama' — automatically runs at concurrency 1
registerProvider(new OllamaProvider());

// Custom id and URL:
registerProvider(new OllamaProvider('local:ollama', 'http://localhost:11434'));
```

Supports embeddings (`toBeSemanticallySimilarTo`).

> **Local provider tip:** Any provider id starting with `local:` is automatically limited to 1 concurrent request, preventing host overload during `it.eachModel` or parallel tests.

### LM Studio (local)

```ts
import { LMStudioProvider } from 'aoide/providers/lmstudio';
// also available as: import { LMStudioProvider } from 'aoide';

// Default id is 'local:lmstudio' — automatically runs at concurrency 1
registerProvider(new LMStudioProvider());
```

### Custom Provider

```ts
import type { LLMProvider } from 'aoide';

const myProvider: LLMProvider = {
  id: 'my-provider',
  async execute(model, request) {
    // ... call your API
    return { text, rawResponse, usage, metadata };
  },
  // Optional — required for toBeSemanticallySimilarTo
  async getEmbeddings(model, request) {
    return { embeddings, usage, metadata };
  },
};

registerProvider(myProvider);
```

### Embedder Setup (required for semantic similarity)

Configure via `aoide.config.ts`:

```ts
const config: AoideConfig = {
  embedder: {
    target: { provider: 'openai', model: 'text-embedding-3-small' },
  },
};
```

Or programmatically in a `beforeAll`:

```ts
import { setupEmbedder } from 'aoide';

setupEmbedder({ target: { provider: 'openai', model: 'text-embedding-3-small' } });
```

---

## Assertions API

All assertions are available on `expect(value)`. `value` may be a `string`, a `ModelResponse` (from `runPrompt`), a `number`, or any other value for the general assertions.

### Synchronous

```ts
// Exact equality
expect(response).toBe('exact value');

// Null / defined / truthiness
expect(response.text).toBeDefined();
expect(noResponse).toBeUndefined();
expect(value).toBeNull();
expect(value).toBeTruthy();
expect(value).toBeFalsy();

// String containment
expect(response).toContain('substring');
expect(response).toContain('substring', { ignoreCase: true });

// Regex format
expect(response).toMatchExactFormat(/^\d{3}-\d{4}$/);

// JSON Schema
expect(response).toMatchJsonSchema({
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
});

// Numeric (useful for token counts, scores)
expect(42).toBeGreaterThan(10);
expect(42).toBeGreaterThanOrEqual(42);
expect(5).toBeLessThan(10);
expect(5).toBeLessThanOrEqual(5);
```

### Negation (`.not`)

Every assertion has a `.not` form:

```ts
expect(response).not.toContain('error');
expect(response).not.toMatchExactFormat(/^\s*$/);
expect(value).not.toBeNull();
expect(value).not.toBeFalsy();
await expect(response).not.toPassLLMJudge({
  criteria: 'Contains harmful content',
  threshold: 0.5,
});
await expect(response).not.toBeSemanticallySimilarTo('off-topic text', 0.5);
```

### LLM-as-Judge

Requires `judge` in config or `setupJudge()`.

> **Important:** These assertions return a `Promise` — always `await` them. A missing `await` silently drops the assertion and the test will always pass.

```ts
await expect(response).toPassLLMJudge({
  criteria: 'The response is concise and directly answers the question.',
  threshold: 0.75,          // 0.0–1.0, default: 0.7
  judgeOverride: { provider: 'openai', model: 'gpt-4o' },  // optional per-call override
});
```

The judge score and reasoning are attached to the test result and visible in the JSON report.

### Tone Checking

> **Important:** Always `await` tone assertions.

```ts
await expect(response).toHaveTone('empathetic');
await expect(response).toHaveTone('professional');
await expect(response).toHaveTone('urgent');
await expect(response).toHaveTone('concise', { threshold: 0.8 });
// Any freeform descriptor works:
await expect(response).toHaveTone('playful and informal');
```

**Built-in tones:** `empathetic`, `professional`, `urgent`. Any other string is used verbatim as the tone description.

### Semantic Similarity

Requires `setupEmbedder()`. Always `await`.

```ts
await expect(response).toBeSemanticallySimilarTo(
  'The capital of France is Paris.',
  0.85,  // cosine similarity threshold, default: 0.85
);
```

### `toMatchJsonSchema` — accepted input types

```ts
expect('{"name":"Alice"}').toMatchJsonSchema({ type: 'object', required: ['name'] });
expect(response).toMatchJsonSchema({ type: 'object', required: ['name'] });
expect({ name: 'Alice' }).toMatchJsonSchema({ type: 'object', required: ['name'] });
```

---

## Actions

### `runPrompt`

```ts
const response = await runPrompt(
  { provider: 'openai', model: 'gpt-4o-mini' },
  {
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    maxTokens: 256,
  },
);

response.text          // string — the model's reply
response.usage         // { promptTokens, completionTokens, totalTokens }
response.metadata      // { latencyMs, providerId, model }
response.rawResponse   // raw API response body
```

Must be called inside an `it()` callback.

### `runTournament`

Evaluates multiple models on the same prompt and returns the winner. Must be called inside an `it()` callback.

```ts
const result = await runTournament('summarisation quality', {
  targets: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ],
  request: { messages: [{ role: 'user', content: 'Summarise: ...' }] },
  judgeCriteria: 'The summary is accurate, concise, and covers the key points.',
  iterations: 3,  // runs per model, default: 1
});

result.winner   // ModelTarget — highest average score
result.scores   // Array<{ target, averageScore, responses, reasoning }>
```

> **Note:** When `iterations > 1`, each iteration bypasses the snapshot cache to ensure independent results. With `iterations: 1` (the default), caching is used normally.

---

## Programmatic API

Run tests from a Node.js script or CI pipeline without shelling out to the CLI:

```ts
import { runTests } from 'aoide';

const result = await runTests({
  // Optional inline config — skips file discovery
  config: {
    judge: { target: { provider: 'openai', model: 'gpt-4o-mini' } },
    reporters: ['terminal'],
  },
  // Or point to a config file:
  // configPath: './my-config.ts',

  // Explicit test files (overrides testMatch globs):
  // testFiles: ['tests/summarise.promptest.ts'],

  // Only run tests whose name matches this regex:
  grep: 'summarise',

  noCache: false,
  updateSnapshots: false,
});

console.log(`Passed: ${result.passed}, Failed: ${result.failed}`);
console.log(`Total cost: $${(result.telemetry.appCost + result.telemetry.evalCost).toFixed(4)}`);

if (!result.ok) process.exit(1);
```

### `RunTestsOptions`

| Field | Type | Description |
| --- | --- | --- |
| `config` | `PromptestConfig` | Inline config; takes precedence over `configPath` |
| `configPath` | `string` | Path to a `aoide.config.ts` file |
| `testFiles` | `string[]` | Explicit file list; overrides `testMatch` globs |
| `grep` | `string` | Regex pattern — only matching tests run |
| `noCache` | `boolean` | Bypass snapshot cache |
| `updateSnapshots` | `boolean` | Re-fetch all prompts and refresh cache |

### `TestRunResult`

| Field | Type | Description |
| --- | --- | --- |
| `passed` | `number` | Tests that passed |
| `failed` | `number` | Tests that failed |
| `skipped` | `number` | Tests that were skipped |
| `durationMs` | `number` | Total wall-clock time in ms |
| `telemetry` | `TelemetrySummary` | Aggregated token usage and cost |
| `ok` | `boolean` | `true` if no tests or afterAll hooks failed |

---

## CLI Reference

```text
aoide [options]
aoide init [--force]
```

### Commands

| Command | Description |
| --- | --- |
| `aoide` | Run all test files matching `testMatch` |
| `aoide init` | Scaffold `aoide.config.ts` and an example test file |
| `aoide init --force` | Overwrite existing config and example files |

### Options

| Flag | Short | Description |
| --- | --- | --- |
| `--help` | `-h` | Show help |
| `--watch` | `-w` | Re-run tests on file change; new test files matching `testMatch` are picked up automatically |
| `--update-snapshots` | `-u` | Refresh snapshot cache |
| `--no-cache` | | Disable caching for this run |
| `--config <path>` | `-c` | Config file (default: `aoide.config.ts`) |
| `--test-match <glob>` | | Override test file glob |
| `--grep <pattern>` | | Only run tests whose name matches the regex |
| `--reporter <name>` | | Reporter: `terminal`, `json` (repeatable) |
| `--json-output <path>` | | Output path for JSON reporter (default: `aoide-results.json`) |
| `--max-workers <n>` | | Max concurrent requests (remote providers only) |
| `--timeout <ms>` | | Override default test timeout (default: `30000`) |
| `--max-retries <n>` | | Max retries on transient API errors (default: `3`) |

---

## Snapshot Caching

aoide maintains two separate caches, both stored inside `__prompt_snapshots__/`:

| Cache | Directory | What is stored |
| --- | --- | --- |
| **App cache** | `__prompt_snapshots__/` | `runPrompt` / `runTournament` responses |
| **Eval cache** | `__prompt_snapshots__/eval/` | Judge and embedding evaluator responses |

Both caches are keyed by a SHA-256 hash of the inputs (provider, model, messages, system prompt, temperature). Add `__prompt_snapshots__/` to `.gitignore`, or commit it to make CI runs free.

```bash
npx aoide --update-snapshots   # re-fetch all app prompts and refresh their cache
npx aoide --no-cache           # bypass both caches entirely
```

| Strategy | Command | Effect |
| --- | --- | --- |
| Use cache (default) | `npx aoide` | Both caches read — no API spend |
| Refresh app prompts | `npx aoide --update-snapshots` | Re-fetches app prompts only; eval cache is preserved |
| Skip all caches | `npx aoide --no-cache` | Always hits live APIs (e.g. CI with live keys) |

> **Why two caches?** `--update-snapshots` is intended for when you change a prompt. It must not silently re-run all your judge evaluations — those are deterministic enough to cache independently and can be expensive to repeat.

> **Cache errors:** If a snapshot file is unreadable or corrupted, aoide logs a warning to stderr and re-fetches from the live API. The run is not aborted. The warning looks like: `[aoide] Failed to read snapshot cache: <reason>`.

---

## Retry Policy

aoide automatically retries requests that fail with transient errors — HTTP 429 (rate limit), 502/503/504 (service unavailable), or network-level errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EHOSTUNREACH`, `ECONNABORTED`). Non-transient errors (400, 401, 404, etc.) are never retried.

The retry delay uses **full-jitter exponential back-off**: `random(0, baseMs × 2^attempt)`. This spreads retries to avoid thundering-herd problems on shared rate limits.

Configure in `aoide.config.ts`:

```ts
const config: AoideConfig = {
  retryPolicy: {
    maxRetries: 3,   // default: 3 — set to 0 to disable retries
    backoffMs: 100,  // default: 100 — base for the exponential back-off
  },
};
```

Override from the CLI:

```bash
npx aoide --max-retries 5
npx aoide --max-retries 0   # disable retries
```

> **Retry count:** `maxRetries: 3` (default) allows up to 4 total attempts — the original attempt plus 3 retries. `maxRetries: 0` disables retries entirely, making exactly 1 attempt with no retries.

---

## Telemetry

After each run, aoide prints a cost summary:

```
AI Telemetry Summary:
  App Tokens:  4,821   (Cost: $0.0007)
  Eval Tokens: 1,203   (Cost: $0.0002)
  Total Cost:  $0.0009
  14 cached requests — no network calls made
```

- **App tokens** — tokens used by `runPrompt` / `runTournament`
- **Eval tokens** — tokens used by the LLM judge and tone/semantic evaluators

Override bundled pricing in config:

```ts
pricingOverrides: {
  'openai:gpt-4o': { input: 2.5, output: 10 },  // USD per 1M tokens
},
```

---

## Concurrency

| Provider type | Default concurrency |
| --- | --- |
| Remote (OpenAI, Anthropic, …) | 5 |
| Local (`local:*` prefix) | 1 |

Override per provider in code:

```ts
import { setProviderConcurrency } from 'aoide';
setProviderConcurrency('openai', 10);
```

Override globally via CLI:

```bash
npx aoide --max-workers 3
```

---

## Common Pitfalls

**Forgetting `await` on async assertions**

`toPassLLMJudge`, `toBeSemanticallySimilarTo`, and `toHaveTone` all return a `Promise`. Forgetting `await` means the assertion never executes and the test passes unconditionally.

```ts
// ❌ Wrong — the assertion is silently dropped
expect(response).toPassLLMJudge({ criteria: 'Is concise' });

// ✅ Correct
await expect(response).toPassLLMJudge({ criteria: 'Is concise' });
```

**Calling `runPrompt` or `runTournament` outside an `it()` block**

Both functions require an active test context. Calling them from `beforeAll`, `afterAll`, or module scope throws `"getCurrentTest() called outside of a running test"`.

```ts
// ❌ Wrong
beforeAll(async () => {
  const response = await runPrompt(target, request); // throws
});

// ✅ Correct
it('my test', async () => {
  const response = await runPrompt(target, request);
});
```

**Using `.only` expecting it to apply across files**

`.only` is scoped to the file it appears in. A `describe.only` in `fileA.promptest.ts` does not suppress tests in `fileB.promptest.ts`.

---

## Troubleshooting

**"Judge not configured"** — Call `setupJudge()` in `beforeAll`, or set `judge` in `aoide.config.ts`.

**"Provider not found: X"** — Call `registerProvider(new XProvider(...))` before your tests run. Typically in `beforeAll`.

**"Provider does not support embeddings"** — The provider in `setupEmbedder` must implement `getEmbeddings()`. Use `OpenAIProvider` or `OllamaProvider`.

**"getCurrentTest() called outside of a running test"** — `runPrompt` and `runTournament` must be called inside an `it()` callback.

**Local model tests fail under concurrent load** — Ensure the provider id starts with `local:` so concurrency is automatically capped at 1.

**Tests are slow** — Check that caching is enabled (no `--no-cache`). For remote providers, increase `--max-workers`.

**Requests keep failing with 429** — The default retry policy (3 retries, 100 ms base back-off) may not be enough for aggressive rate limits. Increase with `--max-retries 5` or reduce `--max-workers`.

**Anthropic responses are cut off** — The default `max_tokens` for the Anthropic provider is `4096`. For longer responses, pass a higher value per request (`runPrompt(target, { maxTokens: 8192, ... })`) or set it globally on the provider: `new AnthropicProvider(id, key, undefined, undefined, 8192)`.

**`aoide init` not recognised** — The `init` sub-command is case-insensitive (`Init`, `INIT` all work). If it still fails, check that you are running `npx aoide init` from the project root.

**Reporter name has no effect** — Check spelling. Supported names are `terminal` and `json`. An unknown name logs `[aoide] Unknown reporter: "...". Supported: terminal, json` and is otherwise ignored. If all reporter names are unknown, `terminal` is used as a fallback.

**`defaultTestTimeout` is rejected at startup** — The value must be a positive number greater than 0. `defaultTestTimeout: 0` or a negative value throws a `ConfigValidationError` at startup.
