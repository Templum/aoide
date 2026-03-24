# Multi-Turn / Conversation Testing Implementation Plan

This document outlines the design and implementation of first-class support for multi-turn (conversational) testing in `aoide`.

## Objective

Introduce an ergonomic API to manage conversation state (history) across multiple LLM turns. This simplifies testing context-dependent behaviours, multi-step workflows, and long-term coherence while leveraging `promptest`'s existing snapshot caching, telemetry, and retry logic.

---

## API Design

### 1. `ConversationOptions`

Defined in `src/api/types.ts`. Mirrors the fields of `PromptRequest` that apply at the conversation level. The system prompt is constructor-only and cannot be overridden per-turn (most providers only support a system prompt at position 0 in the message history).

```ts
export interface ConversationOptions {
  /** System prompt injected as the first message. Constructor-only — cannot be changed after creation. */
  system?: string;
  /** Sampling temperature passed to every turn unless overridden. */
  temperature?: number;
  /** Max completion tokens per turn unless overridden. */
  maxTokens?: number;
  /** Skip snapshot cache for all turns in this conversation. Defaults to false. */
  noCache?: boolean;
}

/** Per-turn overrides. Excludes system prompt, which is fixed at construction time. */
export interface TurnOptions {
  temperature?: number;
  maxTokens?: number;
  noCache?: boolean;
}
```

---

### 2. `createConversation(target, options?)`

Factory function. Returns a `Conversation` interface — the internal class is not exported.

```ts
const conv = createConversation(
  { provider: 'openai', model: 'gpt-4o' },
  { system: 'You are a helpful travel agent.', temperature: 0.7 },
);
```

---

### 3. `Conversation` Interface

The conversation object maintains internal message history and exposes a minimal, focused API.

```ts
export interface Conversation {
  /**
   * Sends a user message, appends it and the model response to history, and returns the response.
   * Per-turn options override the constructor options for this turn only.
   */
  say(content: string, options?: TurnOptions): Promise<ModelResponse>;

  /**
   * Injects a user or system message into history without triggering a model call.
   * Restricted to 'user' and 'system' roles — injecting fake 'assistant' messages
   * is not supported because it produces histories that cannot be replayed from snapshots.
   */
  addMessage(role: 'user' | 'system', content: string): void;

  /** Returns a copy of the current message history (all roles). */
  getHistory(): Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

  /**
   * Returns the assistant responses as a formatted string, suitable for use in
   * LLM judge assertions. Only assistant turns are included — user messages are
   * excluded to prevent false positives when asserting on model output.
   *
   * Format (one turn per line group):
   *   Turn 1: <content>
   *   Turn 2: <content>
   *   ...
   */
  getTranscript(): string;

  /** Wipes the message history while keeping the target and constructor options. */
  clearHistory(): void;

  /**
   * Returns a new Conversation with the same target, constructor options, and a
   * deep copy of the current history. Mutations to either conversation after cloning
   * do not affect each other.
   */
  clone(): Conversation;
}
```

#### Design notes

- `addMessage` is restricted to `'user'` and `'system'` roles. Injecting `'assistant'` messages is intentionally disallowed: synthesised history cannot be reproduced by replaying snapshots, breaking the cache contract.
- `getTranscript()` returns **only assistant turns**. Assertions like `toMatchPersona` or `toContain` applied to a `Conversation` therefore assert on model output — not on user-supplied content in the message history.
- `getHistory()` returns all roles and is intended for inspection and debugging, not for passing to assertions directly.

---

## Snapshot Cache Behaviour

Each `say()` call builds a `PromptRequest` containing the **full message history** up to that turn and passes it to `runPrompt`. The cache key is a hash of `(target, PromptRequest)`.

This has one important implication: **turn snapshots are not independent**. Turn 2's cache key includes the full history, which contains Turn 1's response text. Updating Turn 1's snapshot (via `--update-snapshots`) changes the history fed into Turn 2, producing a different cache key — Turn 2's snapshot is therefore invalidated automatically and will re-run against the live API.

This is the correct behaviour (stale chained snapshots would silently test the wrong history), but implementers should be aware that `--update-snapshots` on a long conversation may trigger more live API calls than expected.

---

## `assertions.ts` Integration

`extractText` is updated to recognise `Conversation` values. When a `Conversation` is passed to `expect()` and a string-based assertion is invoked, `getTranscript()` is called automatically (assistant turns only).

`extractJsonValue` is updated to recognise `Conversation` values by attempting to parse the **last assistant message** as JSON. If the last message is not valid JSON, a `SchemaError` is thrown with a clear message.

```ts
// Asserts on the assistant transcript (all assistant turns concatenated):
await expect(conv).toMatchPersona('a friendly travel agent');
expect(conv).toContain('Paris');

// Asserts on a single response as usual:
expect(res.text).toContain('Rome');
await expect(res).toBeConsistentWith(previousRes);
```

---

## Example Usage

### Basic Turn-Taking

```ts
it('remembers user name across turns', async () => {
  const conv = createConversation(target);

  await conv.say('My name is Alice.');
  const res = await conv.say('What is my name?');

  expect(res.text).toContain('Alice');
});
```

### Asserting on Model Output Across Multiple Turns

```ts
it('maintains a pirate persona throughout the conversation', async () => {
  const conv = createConversation(target, { system: 'You are a pirate.' });

  const res1 = await conv.say('Who are you?');
  const res2 = await conv.say('Where is the treasure?');

  // Assert a single turn against the previous turn:
  await expect(res2).toBeConsistentWith(res1);

  // Assert the full assistant transcript against a persona description.
  // getTranscript() contains only assistant messages — will not match the
  // user-side messages "Who are you?" or "Where is the treasure?".
  await expect(conv).toMatchPersona('a pirate who speaks in nautical slang');
});
```

### Seeding Context with `addMessage`

```ts
it('handles a pre-seeded conversation context', async () => {
  const conv = createConversation(target, { system: 'You are a customer support agent.' });

  // Inject prior context without spending tokens on a live turn:
  conv.addMessage('user', 'I ordered item #1234 last week.');

  const res = await conv.say('Where is my order?');
  expect(res.text).toContain('1234');
});
```

### Branching Conversations

```ts
it('handles different user choices from the same starting point', async () => {
  const baseConv = createConversation(target);
  await baseConv.say('We are starting a text adventure.');

  const pathA = baseConv.clone();
  const resA = await pathA.say('I go left.');
  expect(resA.text).toContain('forest');

  const pathB = baseConv.clone();
  const resB = await pathB.say('I go right.');
  expect(resB.text).toContain('ocean');
});
```

---

## Proposed Changes

1. **`src/api/types.ts`**: Add `ConversationOptions` and `TurnOptions`.
2. **`src/api/conversation.ts`**: Implement the internal `ConversationImpl` class and the `createConversation` factory. The class is not exported — only the `Conversation` interface and factory are public.
3. **`src/api/assertions.ts`**:
   - Add an `isConversation` type guard.
   - Update `extractText` to call `getTranscript()` (assistant-only) when passed a `Conversation`.
   - Update `extractJsonValue` to parse the last assistant message as JSON when passed a `Conversation`.
4. **`src/index.ts`**: Export `createConversation`, `Conversation` (type), `ConversationOptions`, and `TurnOptions` directly — no routing through `actions.ts`.
5. **Tests**: Add `tests/conversation.test.ts` covering:
   - `say()` appends turns and returns `ModelResponse`
   - `say()` passes full history to `runPrompt` on each turn
   - Per-turn `options` override constructor options
   - `getTranscript()` contains only assistant messages in the correct format
   - `getHistory()` contains all roles
   - `addMessage('user', ...)` and `addMessage('system', ...)` work correctly
   - `addMessage` does not accept `'assistant'` role (throws `TypeError`)
   - `clearHistory()` resets message history
   - `clone()` deep-copies history; mutations are independent
   - `expect(conv).toContain(...)` matches against the assistant transcript
   - `expect(conv).toMatchPersona(...)` integrates end-to-end
