/**
 * structure.promptest.ts
 *
 * Output format and structure tests — verifies the model respects explicit
 * formatting constraints: JSON schema, regex patterns, and structural layouts.
 */
import { describe, it, expect, runPrompt } from '@templum/aoide';
import type { ModelTarget } from '@templum/aoide';

const TARGET: ModelTarget = { provider: 'local:lmstudio', model: 'google/gemma-3-12b' };

describe('Output structure', () => {
  it('returns valid JSON matching a defined schema', async () => {
    const response = await runPrompt(TARGET, {
      system: 'You are a JSON-only API. Respond with raw JSON and nothing else.',
      messages: [
        {
          role: 'user',
          content:
            'Return a JSON object with these fields: ' +
            '"name" (string), "age" (integer), "active" (boolean). ' +
            'Use realistic placeholder values.',
        },
      ],
      temperature: 0.0,
    });

    expect(response).toMatchJsonSchema({
      type: 'object',
      required: ['name', 'age', 'active'],
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0 },
        active: { type: 'boolean' },
      },
      additionalProperties: false,
    });
  });

  it('returns a numbered list when explicitly requested', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content:
            'List exactly three programming languages. ' +
            'Format your response as a numbered list: 1. ... 2. ... 3. ...',
        },
      ],
      temperature: 0.0,
    });

    // All three numbered items must be present.
    expect(response).toMatchExactFormat(/1\.\s+\S+[\s\S]*2\.\s+\S+[\s\S]*3\.\s+\S+/);
  });

  it('follows an intro → bullet points → conclusion structure', async () => {
    const response = await runPrompt(TARGET, {
      messages: [
        {
          role: 'user',
          content:
            'Describe the benefits of code reviews. ' +
            'Structure your response as: a one-sentence introduction, ' +
            'three bullet points, then a one-sentence conclusion.',
        },
      ],
      temperature: 0.2,
    });

    await expect(response).toBeStructurallyEquivalent(
      'one-sentence introduction, followed by exactly three bullet points, followed by a one-sentence conclusion',
      { threshold: 0.75 },
    );
  });

  it('returns a JSON array of strings when asked', async () => {
    const response = await runPrompt(TARGET, {
      system: 'You are a JSON-only API. Respond with raw JSON and nothing else.',
      messages: [
        {
          role: 'user',
          content: 'Return a JSON array of exactly four continent names.',
        },
      ],
      temperature: 0.0,
    });

    expect(response).toMatchJsonSchema({
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 4,
      maxItems: 4,
    });
  });
});
