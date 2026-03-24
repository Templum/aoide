import { createHash } from 'node:crypto';
import type { ModelTarget, PromptRequest } from '../providers/types.js';

export function generatePromptHash(target: ModelTarget, request: PromptRequest): string {
  const payload = {
    provider: target.provider,
    model: target.model,
    system: request.system ?? null,
    // Serialise as a proper JSON array so that message content containing the
    // old pipe delimiter can never produce the same hash as a different set of
    // messages. JSON.stringify handles all necessary escaping.
    messages: request.messages.map(m => ({ role: m.role, content: m.content })),
    temperature: request.temperature ?? null,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
