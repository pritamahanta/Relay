import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingProvider } from '../interfaces/embedding-provider.interface';
import { LlmProvider } from '../interfaces/llm-provider.interface';
import { RateLimiter } from '../rate-limiter';

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

// Matches the truncated dimension baked into the pgvector column
// (infra/init-db/02-llm-cache-table.sql). If you change one, change both.
const EMBEDDING_OUTPUT_DIMENSIONS = 768;

@Injectable()
export class GeminiProvider implements EmbeddingProvider, LlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  private readonly apiKey: string;
  private readonly embeddingModel: string;
  private readonly completionModel: string;

  // Free-tier Gemini Flash allows ~15 requests/minute (verify current
  // limits in Google AI Studio — free-tier caps change). Kept
  // conservative on purpose; a 429 here becomes a job retry, not a crash,
  // but better to not lean on that.
  private readonly rateLimiter = new RateLimiter(12, 60_000);

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get('GEMINI_API_KEY', '');
    this.embeddingModel = this.configService.get(
      'GEMINI_EMBEDDING_MODEL',
      'gemini-embedding-001',
    );
    this.completionModel = this.configService.get(
      'GEMINI_COMPLETION_MODEL',
      'gemini-3.6-flash',
    );

    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not set — llm-inference jobs will fail until it is configured.',
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    await this.rateLimiter.acquire();

    const url = `${GEMINI_BASE_URL}/${this.embeddingModel}:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_OUTPUT_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini embedding request failed (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      embedding: { values: number[] };
    };

    return data.embedding.values;
  }

  async complete(prompt: string): Promise<string> {
    await this.rateLimiter.acquire();

    const url = `${GEMINI_BASE_URL}/${this.completionModel}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini completion request failed (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      candidates: { content: { parts: { text: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error(
        'Gemini completion response had no candidate text (likely blocked by safety filters or an empty response).',
      );
    }

    return text;
  }
}
