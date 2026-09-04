import { ConfigService } from '@nestjs/config';

import { SemanticCacheService } from './semantic-cache.service';
import { LlmCacheRepository } from '../database/repositories/llm-cache.repository';
import type { EmbeddingProvider } from './interfaces/embedding-provider.interface';
import type { LlmProvider } from './interfaces/llm-provider.interface';

describe('SemanticCacheService', () => {
  let service: SemanticCacheService;

  const embeddingProvider = {
    embed: jest.fn(),
  };

  const llmProvider = {
    complete: jest.fn(),
  };

  const llmCacheRepository = {
    findSimilar: jest.fn(),
    save: jest.fn(),
  };

  const configService = {
    get: jest.fn((key: string, fallback: string) => fallback),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    configService.get.mockImplementation(
      (_key: string, fallback: string) => fallback,
    );

    service = new SemanticCacheService(
      embeddingProvider as unknown as EmbeddingProvider,
      llmProvider as unknown as LlmProvider,
      llmCacheRepository as unknown as LlmCacheRepository,
      configService as unknown as ConfigService,
    );
  });

  it('returns the cached response on a cache hit without calling the LLM', async () => {
    embeddingProvider.embed.mockResolvedValue([0.1, 0.2, 0.3]);

    llmCacheRepository.findSimilar.mockResolvedValue({
      id: 'cache-1',
      prompt: 'a similar earlier prompt',
      response: 'cached answer',
      similarity: 0.97,
    });

    const result = await service.getCompletion('a new prompt');

    expect(result).toEqual({
      response: 'cached answer',
      cacheHit: true,
      similarity: 0.97,
    });

    expect(llmProvider.complete).not.toHaveBeenCalled();
    expect(llmCacheRepository.save).not.toHaveBeenCalled();
  });

  it('calls the LLM and stores the result on a cache miss', async () => {
    embeddingProvider.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    llmCacheRepository.findSimilar.mockResolvedValue(null);
    llmProvider.complete.mockResolvedValue('fresh answer');

    const result = await service.getCompletion('a genuinely new prompt');

    expect(result).toEqual({
      response: 'fresh answer',
      cacheHit: false,
    });

    expect(llmProvider.complete).toHaveBeenCalledWith(
      'a genuinely new prompt',
    );

    expect(llmCacheRepository.save).toHaveBeenCalledWith(
      'a genuinely new prompt',
      [0.1, 0.2, 0.3],
      'fresh answer',
      86_400_000,
    );
  });

  it('propagates embedding failures instead of silently falling back to the LLM', async () => {
    embeddingProvider.embed.mockRejectedValue(
      new Error('Gemini embedding request failed (429): rate limited'),
    );

    await expect(
      service.getCompletion('some prompt'),
    ).rejects.toThrow('rate limited');

    expect(llmProvider.complete).not.toHaveBeenCalled();
  });
});
