/**
 * consistency.promptest.ts
 *
 * Factual consistency and multi-turn coherence tests — verifies the model
 * does not contradict source documents or its own prior responses.
 */
import { describe, it, expect, runPrompt } from '@templum/aoide';
import type { ModelTarget } from '@templum/aoide';

const TARGET: ModelTarget = { provider: 'local:lmstudio', model: 'google/gemma-3-12b' };

// A controlled reference document used across multiple tests.
const PRODUCT_SPEC = `
Acme Widget Pro — Product Specification

- Release date: March 2025
- Weight: 250g
- Battery life: 48 hours
- Colours available: Midnight Black, Arctic White, Ocean Blue
- Warranty: 2 years
- Price: $149 USD
- Compatible operating systems: iOS 16+, Android 13+
`.trim();

describe('Factual consistency', () => {
  it('summarises a product spec without introducing false facts', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content:
            `Summarise the following product specification in three bullet points:\n\n${PRODUCT_SPEC}`,
        },
      ],
      temperature: 0.2,
    });

    await expect(response).toBeFactuallyConsistent(PRODUCT_SPEC, { threshold: 0.8 });
  });

  it('answers a question about source material without hallucinating', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content:
            `Based only on the following spec, what colours is the product available in?\n\n${PRODUCT_SPEC}`,
        },
      ],
      temperature: 0.0,
    });

    // All three colours must be present and no invented ones.
    await expect(response).toBeFactuallyConsistent(PRODUCT_SPEC, { threshold: 0.85 });
    expect(response).toContain('Black', { ignoreCase: true });
    expect(response).toContain('White', { ignoreCase: true });
    expect(response).toContain('Blue', { ignoreCase: true });
  });

  it('does not contradict itself across two independent responses', async () => {
    const question = {
      messages: [
        {
          role: 'user' as const,
          content: 'Is TypeScript a statically typed language? Answer in one sentence.',
        },
      ],
      temperature: 0.0,
    };

    const res1 = await runPrompt(TARGET, question);
    const res2 = await runPrompt(TARGET, question);

    // Both responses should be consistent with each other.
    await expect(res2).toBeConsistentWith(res1, { threshold: 0.8 });
  });

  it('translation preserves factual content from the source', async () => {
    const source = 'The Eiffel Tower is located in Paris, France, and was completed in 1889.';

    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content: `Translate the following to Spanish:\n\n"${source}"`,
        },
      ],
      temperature: 0.0,
    });

    // The translation must preserve all facts from the source.
    await expect(response).toBeFactuallyConsistent(source, { threshold: 0.8 });
  });
});
