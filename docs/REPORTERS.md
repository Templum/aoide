# Implementation Plan: GitHub Actions (Markdown) and HTML Reporters

> **Reviewed:** 2026-03-24 — Critical architectural review against actual codebase state.

## 1. Overview

As `aoide` matures, developers and teams need better visibility into their prompt testing workflows outside the terminal. This plan details the architectural approach for implementing two new reporters:
1. **GitHub Actions / Markdown Reporter:** For CI/CD integration, PR comments, and GitHub Step Summaries.
2. **HTML Reporter:** A rich, standalone visual dashboard for side-by-side model comparisons, detailed trace inspection, and A/B test analysis.

Both reporters implement the existing `Reporter` interface defined in `src/reporters/base.ts` and are registered via `src/reporters/factory.ts`.

---

## 2. Critical Issues with the Original Plan

The following issues must be resolved before implementation begins. They are ordered by severity.

### 2.1 [BLOCKER] Config System Does Not Support Reporter Options

**Problem:** The SPEC's proposed configuration format uses a tuple syntax for reporters with options:

```typescript
// SPEC proposal — DOES NOT WORK with the current codebase
reporters: [
  'terminal',
  ['markdown', { outputFile: './ci/summary.md' }],
  ['html', { outputFile: './coverage/aoide-ui.html', title: 'Q2 Prompt Evals' }]
]
```

The `PromptestConfig` interface in `src/utils/config.ts` defines `reporters` as `string[]`. The `validateConfig` function explicitly enforces that every element is a `string`. The `buildReporters` factory in `src/reporters/factory.ts` only accepts strings. Passing a tuple will throw a `ConfigValidationError` at startup and the reporter will never be created.

**Fix Required:** Before implementing the reporters, make the following changes:

1. **Extend the config type** in `src/utils/config.ts`:
   ```typescript
   export type ReporterConfig =
     | string
     | ['markdown', MarkdownReporterOptions]
     | ['html', HtmlReporterOptions];

   export interface MarkdownReporterOptions {
     outputFile?: string;
   }

   export interface HtmlReporterOptions {
     outputFile?: string;
     title?: string;
   }

   export interface PromptestConfig {
     // ...existing fields...
     reporters?: ReporterConfig[];
   }
   ```

2. **Update `validateConfig`** to accept both `string` and `[string, object]` tuple shapes.

3. **Update `buildReporters`** in `src/reporters/factory.ts` to handle both forms and pass options to the constructor.

### 2.2 [BLOCKER] `Test` Has No `judgeResults` Exposed to JSON Reporter; Markdown Reporter Needs It

**Problem:** The plan says the Markdown reporter should display "LLM Judge Reasoning". The `Test` class in `src/core/ast.ts` does have a `judgeResults: JudgeResult[]` field (where `JudgeResult = { criteria, score, reasoning }`), but the `JSONReporter`'s `testToRecord` helper does **not** copy it into `TestRecord`. Since the Markdown reporter must operate identically — working from the same `Suite` object in `onRunComplete` — it can access `test.judgeResults` directly from the AST. This is fine, but the plan must make this access pattern explicit. Do **not** assume a pre-serialized record shape will carry this data.

**Fix Required:** The markdown and HTML reporters must traverse the `Suite` AST directly (as the JSON reporter does), not rely on a shared intermediate record. Add `judgeResults` to `TestRecord` in the JSON reporter as well for consistency.

### 2.3 [SIGNIFICANT] HTML Reporter Template File Will Break the Build

**Problem:** The plan proposes creating `src/reporters/html/template.html`. The `tsup.config.ts` build system only bundles TypeScript source. Static assets (`.html` files) are not automatically copied to `dist/`. The reporter logic in `html.ts` uses `fs` to read `template.html` at runtime, but after `npm install` from a published package there will be no `.html` file alongside the `.js` output unless the build explicitly handles it.

**Fix Required:** Choose one of:
- **(Preferred)** Inline the HTML template as a TypeScript string constant or tagged template literal in `html.ts` itself. This is self-contained and zero-dependency. The file can be large but it avoids the asset pipeline problem entirely.
- Add the `.html` file to `tsup` copy assets configuration and ensure it is included in the `package.json` `files` array.

The preferred approach is the inline template — it aligns with the "zero-dependency, self-contained" goal already stated in the plan.

### 2.4 [SIGNIFICANT] `onRunComplete` Receives the Root `Suite`, Not a `TestRunResults` Object

**Problem:** The plan repeatedly refers to `onRunComplete(results: TestRunResults)` as the method signature. This type does not exist in the codebase. The actual interface is:

```typescript
onRunComplete?(suite: Suite): void | Promise<void>;
```

The argument is the root `Suite` instance from `src/core/ast.ts`. Reporters must walk the suite tree themselves to collect data, exactly as `JSONReporter.onRunComplete` does with its `collectAllTests` helper. Both new reporters should replicate this traversal pattern.

### 2.5 [SIGNIFICANT] No `skipped` Count in the Plan's Header

**Problem:** The plan's "Header" block lists "Total Tests, Passed, Failed, Duration" but omits `skipped`. The `Test.status` enum includes `'skipped'` and the terminal reporter already surfaces this. The Markdown and HTML reporters should treat `skipped` as a first-class status to avoid confusing users when `passed + failed ≠ total`.

### 2.6 [MODERATE] `afterAllErrors` Are Silently Dropped

**Problem:** The `Suite` class has an `afterAllErrors` array for `afterAll` hook failures. These errors are surfaced by the terminal reporter via `onAfterAllError` and reflected in the JSON output. The Markdown reporter plan does not mention them. They must appear in the failure section of the Markdown report, as they can be the root cause of downstream test failures.

### 2.7 [MODERATE] GitHub Step Summary Append Strategy Is Unsafe

**Problem:** The plan says "it can automatically append to `process.env.GITHUB_STEP_SUMMARY`". The `GITHUB_STEP_SUMMARY` environment variable contains a **file path** — you append to the file at that path, not to the env var string. The implementation must:

```typescript
import { appendFileSync } from 'node:fs';
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath) appendFileSync(summaryPath, markdownContent, 'utf8');
```

Using `process.env.GITHUB_STEP_SUMMARY` directly as a write target is incorrect. Document this clearly in the implementation.

### 2.8 [MODERATE] No Atomic Write Strategy for Markdown/HTML Output

**Problem:** The JSON reporter correctly uses a temp-file + `renameSync` pattern to avoid partial reads if the process is interrupted. The plan does not mention this for the Markdown or HTML reporters. Given that CI pipelines often read the summary file immediately after the process exits, the same atomic write pattern must be used.

### 2.9 [MINOR] `'github'` Alias Is Undocumented as a Distinct Concern

**Problem:** The plan mentions registering both `'markdown'` and `'github'` as string identifiers without explaining the distinction. Recommend a single identifier `'markdown'` whose behavior changes based on env detection (auto-appends to step summary when `GITHUB_ACTIONS=true`). Adding `'github'` as an alias in `factory.ts` is fine but must be noted as a deprecated alias path to avoid confusion.

### 2.10 [MINOR] Tournament / A/B Test Data Has No Type in the AST

**Problem:** The plan's "Tournaments / A/B Tests" section implies the runner stores tournament results on the `Suite` or `Test` objects. As of the current AST (`src/core/ast.ts`), no `TournamentResult` is stored on either class. Before the HTML Comparison View can be implemented, this data must be captured in the AST. This is a dependency outside the scope of the reporters themselves — flag it as a prerequisite.

---

## 3. Revised Implementation Plan

### 3.1 GitHub Actions / Markdown Reporter (`markdown`)

#### Objective
Generate concise GFM output highlighting failures, judge reasoning, and cost telemetry. Optimized for GitHub PR comments and the `$GITHUB_STEP_SUMMARY` file.

#### Architectural Approach
- Use TypeScript template literals only. No external Markdown libraries.
- Single reporter class handles both file output and optional step summary append.
- Atomic file write (temp file + rename), matching `JSONReporter` pattern.

#### Data Access Pattern
Traverse the `Suite` AST in `onRunComplete(rootSuite: Suite)`:
```typescript
function collectAllTests(suite: Suite): Test[] {
  return [...suite.tests, ...suite.childSuites.flatMap(collectAllTests)];
}
```
Access `test.judgeResults`, `test.telemetry`, `test.error`, and `suite.afterAllErrors` directly.

#### Output Layout
1. **Header:** Overall pass/fail emoji + metrics table (Total, Passed, Failed, Skipped, Duration).
2. **Telemetry Table:** App Tokens / Cost vs. Eval Tokens / Cost vs. Total. Include cached request count.
3. **Failures Section:** One `<details>` block per failed test:
   - Full suite path (e.g., `Suite > Nested Suite > Test Name`)
   - Error message (not raw stack trace — stacks are noisy in Markdown)
   - Each `JudgeResult`: criteria, score vs threshold, reasoning in a blockquote
4. **`afterAll` Errors Section:** Separate block for hook-level failures.
5. **GitHub Step Summary:** If `process.env.GITHUB_ACTIONS === 'true'` and `process.env.GITHUB_STEP_SUMMARY` is set, append the same content to that file path.

#### Implementation Steps
1. Create `src/reporters/markdown.ts` implementing `Reporter`.
2. Implement `onRunStart` to capture start time.
3. Implement `onRunComplete(rootSuite: Suite)` — traverse the tree, build markdown string, write atomically.
4. Add private helpers: `buildHeader()`, `buildTelemetryTable()`, `buildFailureDetails()`, `buildAfterAllErrors()`.
5. Update `src/reporters/factory.ts` to handle `'markdown'` (and `'github'` as an alias).
6. Extend `PromptestConfig` and `validateConfig` in `src/utils/config.ts` to support `['markdown', MarkdownReporterOptions]` tuple syntax.

---

### 3.2 HTML Reporter (`html`)

#### Objective
A zero-dependency, offline-capable single-file HTML dashboard for visual inspection of test results, judge reasoning, and model comparisons.

#### Architectural Approach
- **No separate template file.** The HTML/CSS/JS is stored as an inline TypeScript string constant in `src/reporters/html.ts`. This avoids the build asset pipeline problem entirely.
- Data injection: serialize the `Suite` AST to a plain JSON-serializable structure (reuse/extend the `SuiteRecord`/`TestRecord` types from `json.ts`, adding `judgeResults`) and inject into a `<script>` tag as `window.__PROMPTEST_RESULTS__ = ...`.
- UI: Vanilla JS (ES6+), vanilla CSS (Grid/Flexbox), inline SVG icons. No framework dependencies.
- Atomic file write.

#### Data Serialization
Extend the JSON reporter's record types (or define parallel ones) to include `judgeResults`:
```typescript
interface TestRecord {
  // ...existing fields from json.ts...
  judgeResults: Array<{ criteria: string; score: number; reasoning: string }>;
}
```

**Note:** Until `TournamentResult` is stored on the AST, the Comparison View cannot be fully implemented. The HTML template should reserve the UI section and display a placeholder when no tournament data is available.

#### Layout & Features
1. **Sidebar:** Suite list with Red/Green indicators. Filter buttons: All / Failed / Skipped.
2. **Global Dashboard (default view):**
   - Pass rate as a CSS conic-gradient donut (no canvas, no chart library).
   - Telemetry breakdown table.
3. **Test Detail View:**
   - Suite breadcrumb path.
   - Error message and first relevant stack frame (strip `node_modules` frames).
   - Judge Results: criteria, score bar, reasoning in a styled blockquote.
4. **Comparison View:** Deferred until `TournamentResult` is captured in the AST.

#### Implementation Steps
1. Create `src/reporters/html.ts` implementing `Reporter`.
2. Define `buildSerializableReport(rootSuite: Suite): HtmlReportData` — a plain-object tree with `judgeResults` included.
3. Define the HTML template as an exported `const HTML_TEMPLATE: string` (or inline it directly in the reporter). Keep CSS and JS in the same string for portability.
4. In `onRunComplete`: serialize data, inject into template via string replace of `/* INJECT_RESULTS_HERE */`, write atomically.
5. Update `src/reporters/factory.ts` to handle `'html'`.
6. Extend `PromptestConfig` and `validateConfig` to support `['html', HtmlReporterOptions]` tuple syntax.

---

## 4. Revised Configuration Schema

```typescript
// src/utils/config.ts additions

export interface MarkdownReporterOptions {
  /** Output file path. Defaults to 'aoide-report.md'. */
  outputFile?: string;
}

export interface HtmlReporterOptions {
  /** Output file path. Defaults to 'aoide-report.html'. */
  outputFile?: string;
  /** Title shown in the HTML report header. */
  title?: string;
}

export type ReporterConfig =
  | 'terminal'
  | 'json'
  | 'markdown'
  | 'github'                              // alias for 'markdown'
  | 'html'
  | ['markdown', MarkdownReporterOptions]
  | ['html', HtmlReporterOptions];

export interface PromptestConfig {
  // ...all existing fields unchanged...
  reporters?: ReporterConfig[];
}
```

Example usage in `aoide.config.ts`:

```typescript
export default {
  reporters: [
    'terminal',
    ['markdown', { outputFile: './ci/summary.md' }],
    ['html', { outputFile: './reports/aoide-ui.html', title: 'Q2 Prompt Evals' }]
  ]
}
```

**Validation:** `validateConfig` must be updated to accept both `string` and `[string, object]` array items. The current guard `every(x => typeof x === 'string')` will reject tuples and throw `ConfigValidationError`.

---

## 5. Implementation Order & Dependencies

The items below must be done in sequence — each unblocks the next:

| Step | Task | Touches |
|:-----|:-----|:--------|
| 1 | Extend `ReporterConfig` union type and update `validateConfig` | `src/utils/config.ts` |
| 2 | Update `buildReporters` factory to parse tuples and pass options | `src/reporters/factory.ts` |
| 3 | Implement `MarkdownReporter` | `src/reporters/markdown.ts` |
| 4 | Implement `HtmlReporter` (with inline template) | `src/reporters/html.ts` |
| 5 | Add `judgeResults` to `TestRecord` in JSON reporter (consistency) | `src/reporters/json.ts` |
| 6 | Add tournament AST support (prerequisite for HTML Comparison View) | `src/core/ast.ts` (separate ticket) |

---

## 6. Summary

The core goal — zero-dependency reporters using template literals for Markdown and an inline data-injected HTML shell — is sound. The blockers are all in the scaffolding, not the output logic:

1. The config/factory layer must be extended before any new reporter can be instantiated with options.
2. The HTML template must be inlined, not read from a `.html` file, to survive the build and npm publish correctly.
3. Both reporters must follow the `Suite` traversal pattern from `json.ts`, not an imagined `TestRunResults` type.
4. Minor gaps (skipped count, `afterAllErrors`, atomic writes, GitHub step summary file path) are low-effort but will cause real confusion in CI if left unaddressed.
