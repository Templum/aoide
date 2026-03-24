import { OpenAIProvider } from './openai.js';

export class LMStudioProvider extends OpenAIProvider {
  /**
   * @param id  Provider ID. Use a "local:" prefix (e.g. "local:lmstudio") to
   *            automatically limit concurrency to 1 — recommended for local models
   *            to avoid overwhelming host resources.
   * @param url LM Studio base URL (default: http://127.0.0.1:1234/v1)
   */
  constructor(id: string = 'local:lmstudio', url: string = 'http://127.0.0.1:1234/v1') {
    super(id, 'lm-studio-dummy-key', url);
  }
}
