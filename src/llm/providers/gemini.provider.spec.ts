import { ConfigService } from '@nestjs/config';

import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  const config: Record<string, string> = {
    GEMINI_API_KEY: 'test-key',
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
    GEMINI_COMPLETION_MODEL: 'gemini-2.5-flash',
  };

  const configService = {
    get: jest.fn((key: string, fallback?: string) => config[key] ?? fallback),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();

    provider = new GeminiProvider(
      configService as unknown as ConfigService,
    );
  });

  describe('embed', () => {
    it('returns the embedding values from a successful response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: { values: [0.1, 0.2, 0.3] } }),
      });

      const result = await provider.embed('hello world');

      expect(result).toEqual([0.1, 0.2, 0.3]);

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('gemini-embedding-001:embedContent');
      expect(url).toContain('key=test-key');

      const body = JSON.parse(options.body);
      expect(body.content.parts[0].text).toBe('hello world');
      expect(body.outputDimensionality).toBe(768);
    });

    it('throws with the response body when the request fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      });

      await expect(provider.embed('hello')).rejects.toThrow(
        'Gemini embedding request failed (429): rate limited',
      );
    });
  });

  describe('complete', () => {
    it('returns the candidate text from a successful response', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: 'a generated answer' }] } },
          ],
        }),
      });

      const result = await provider.complete('explain job queues');

      expect(result).toBe('a generated answer');
    });

    it('throws when the response has no candidate text', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ candidates: [] }),
      });

      await expect(provider.complete('explain job queues')).rejects.toThrow(
        'Gemini completion response had no candidate text',
      );
    });
  });
});
