# Specification: `aoide` - The Prompt Unit Testing Framework

## 1. Overview & Scope

`aoide` is a TypeScript testing framework designed for Large Language Model (LLM) prompts and AI workflows. It treats non-deterministic AI outputs as testable software artifacts by combining standard software assertions with LLM-as-a-Judge evaluations, semantic similarity checks, and strict cost tracking.

The framework provides a familiar `describe`/`it` API for test authors, a high-performance concurrent runner, and robust telemetry for monitoring token usage and costs.

---

## 2. Core Runtime & Architecture

The `aoide` runtime is built on a decoupled architecture that separates test discovery, orchestration, and model execution.

### Abstract Execution Tree (AST)

When test files are loaded, the framework builds an internal [Suite](../src/core/ast.ts) and [Test](../src/core/ast.ts) tree. This AST captures test metadata, hooks (`beforeAll`, `afterEach`, etc.), and aggregated telemetry data.

### The Runner

The [Runner](../src/core/runner.ts) is the orchestration engine. It traverses the AST and executes tests. It handles hook lifecycle management, timeout enforcement, and parallel execution of tests marked as concurrent.

### The Dispatcher & Task Queue

Every model interaction (prompt or evaluation) is routed through the [Dispatcher](../src/core/dispatcher.ts).

- **Task Queuing:** Tasks are grouped by their target provider ID.
- **Concurrency Enforcement:** The Dispatcher respects global limits (set via `--max-workers`) and provider-specific limits. Providers with a `local:` prefix are automatically capped at 1 concurrent request to protect host resources.
- **Retries:** Employs a full-jitter exponential back-off strategy for transient API errors (429, 50x) via the `withRetry` utility.

### Execution Context

The framework uses `AsyncLocalStorage` in [src/core/context.ts](../src/core/context.ts) to track the active test during execution, allowing actions like `runPrompt` to automatically associate telemetry and judge results with the correct test record.

---

## 3. API Surface

`aoide` exposes two primary API surfaces: one for test authors (Library) and one for execution and tooling (CLI).

### Library API ([src/index.ts](../src/index.ts))

The entrypoint for writing tests. It exports:

- **Test Structure:** `describe`, `it`, `test`, and lifecycle hooks.
- **Assertions:** The `expect` builder for both deterministic and AI-native checks.
- **Actions:** High-level functions like `runPrompt` and `runTournament`.
- **Setup:** Configuration utilities like `registerProvider` and `setupJudge`.

### CLI Engine ([src/cli/index.ts](../src/cli/index.ts))

The engine powering the `aoide` command. It manages:

- **Discovery:** Globbing for test files and loading them into the aggregate root suite.
- **Watch Mode:** Efficiently re-running only relevant tests when files or configurations change.
- **Initialization:** Scaffolding projects via the `aoide init` command.

---

## 4. Core Components

### Actions

| Action | Source File | Technical Description |
| :--- | :--- | :--- |
| `runPrompt` | [src/api/actions.ts](../src/api/actions.ts) | Executes an LLM prompt. Integrates with the `SnapshotManager` for application-level caching. |
| `runTournament` | [src/api/actions.ts](../src/api/actions.ts) | Performs multi-model A/B testing. Iteratively scores targets using an LLM judge to determine a winner. |

### Assertions

| Category | Source File | Key Implementations |
| :--- | :--- | :--- |
| **AI Evaluations** | [src/api/assertions.ts](../src/api/assertions.ts) | `toPassLLMJudge`, `toBeSemanticallySimilarTo`, `toHaveTone`, `toBeFactuallyConsistent`, `toMatchPersona`. |
| **Deterministic** | [src/api/assertions.ts](../src/api/assertions.ts) | `toBe`, `toContain`, `toMatchJsonSchema` (via AJV), `toMatchExactFormat`. |
| **Budget Checks** | [src/api/assertions.ts](../src/api/assertions.ts) | `toHaveTokensBelow`, `toHaveCostBelow` (validates against computed telemetry). |

### Caching

The framework maintains a dual-layer SHA-256 snapshot cache to ensure fast, cost-effective re-runs.

| Cache Type | Source File | Store Location | Purpose |
| :--- | :--- | :--- | :--- |
| **App Cache** | [src/cache/snapshot-manager.ts](../src/cache/snapshot-manager.ts) | `__prompt_snapshots__/` | Caches standard prompts. Refreshed via `--update-snapshots`. |
| **Eval Cache** | [src/cache/eval-cache.ts](../src/cache/eval-cache.ts) | `__prompt_snapshots__/eval/` | Caches judge and evaluation results. Preserved during app snapshot updates. |

---

## 5. Reporter Architecture

The reporting system uses a provider pattern defined by the [Reporter](../src/reporters/base.ts) interface. Reporters hook into lifecycle events (`onRunStart`, `onTestPass`, etc.) to process test results and telemetry.

The [buildReporters](../src/reporters/factory.ts) factory instantiates reporters based on user configuration.

| Reporter | Status | Description |
| :--- | :--- | :--- |
| `terminal` | Implemented | Interactive CLI output with color-coded results and telemetry summaries. |
| `json` | Implemented | Exports a full execution trace and cost breakdown to `aoide-results.json`. |
| `markdown` | Planned | Generates GFM summaries for GitHub Actions Step Summaries and PR comments. |
| `html` | Planned | A standalone visual dashboard for side-by-side model comparisons and trace inspection. |

---

## 6. Cost Tracking & Error Handling

### Telemetry Tracking

The [TelemetryTracker](../src/telemetry/tracker.ts) passively intercepts model usage data. It resolves pricing using a bundled [pricing.json](../src/telemetry/pricing.json) registry, which can be overridden via `aoide.config.ts`.

- **App Cost:** Project production inference spend.
- **Eval Cost:** Overhead spend from testing and evaluation.

### Error Categorization

To ensure precise debugging, `aoide` uses specialized error classes in [src/utils/errors.ts](../src/utils/errors.ts):

- `ApiError`: Transient or permanent API failures (includes status codes).
- `ParseError`: Failures in parsing JSON or structured data from model outputs.
- `JudgeError`: Explicit failures from LLM-as-judge assertions (includes reasoning and score).
- `SchemaError`: Failures in JSON Schema validation.

---

## 7. Future Features

### Conversation Testing

Planned support for first-class multi-turn testing. This will include a `Conversation` interface for managing message history, turn-based snapshots, and transcript-level assertions.

- **Reference:** [docs/CONV_FEATURE.md](../CONV_FEATURE.md)
- **Key Symbols:** `createConversation`, `say`, `getTranscript`, `clone`.
