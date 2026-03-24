/**
 * generation.promptest.ts
 *
 * Core generation quality tests — verifies the model produces coherent,
 * relevant, and appropriately scoped responses to straightforward prompts.
 */
import { describe, it, expect, runPrompt } from '@templum/aoide';
import type { ModelTarget } from '@templum/aoide';

const TARGET: ModelTarget = { provider: 'local:lmstudio', model: 'google/gemma-3-12b' };

describe('Generation quality', () => {
  it('explains a technical concept clearly for a junior audience', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content: 'Explain what a REST API is in two sentences, suitable for a junior developer.',
        },
      ],
      temperature: 0.3,
    });

    await expect(response).toPassLLMJudge({
      criteria:
        'The response must explain REST API clearly and concisely in no more than two sentences. ' +
        'It must be understandable by someone new to programming — no unexplained jargon.',
      threshold: 0.8,
    });
  });

  it('answers a factual question accurately', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content: 'What is the capital of France?',
        },
      ],
      temperature: 0.0,
    });

    expect(response).toContain('Paris', { ignoreCase: true });
  });

  it('follows a system prompt persona', async () => {
    const response = await runPrompt(TARGET, {
      system:
        'You are a concise assistant. ' +
        'You MUST respond in exactly one sentence. ' +
        'Do not use more than one sentence under any circumstances.',
      messages: [
        {
          role: 'user',
          content: 'What is photosynthesis?',
        },
      ],
      temperature: 0.0,
    });

    await expect(response).toMatchPersona(
      'an assistant that responds in exactly one sentence — terse and direct, no elaboration',
      { threshold: 0.65 },
    );
  });

  it('produces a professional tone for a business context', async () => {
    const response = await runPrompt(TARGET, {
      system: 'You are a professional business writing assistant.',
      messages: [
        {
          role: 'user',
          content: 'Write a one-sentence apology to a client for a delayed delivery.',
        },
      ],
      temperature: 0.3,
    });

    await expect(response).toHaveTone('professional', { threshold: 0.75 });
  });

  it('stays within a requested token budget', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content: 'List three benefits of unit testing. Be brief.',
        },
      ],
      maxTokens: 120,
      temperature: 0.3,
    });

    // Local model — cost is always $0, but token budget should be respected.
    expect(response).toHaveTokensBelow(150);
  });
});
