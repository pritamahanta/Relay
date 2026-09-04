import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './interfaces/embedding-provider.interface';
import {
  LLM_PROVIDER,
  type LlmProvider,
} from './interfaces/llm-provider.interface';
import { LlmCacheRepository } from '../database/repositories/llm-cache.repository';

export interface SemanticCacheResult {
  response: string;
  cacheHit: boolean;
  similarity?: number;
}

@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);

  private readonly similarityThreshold: number;
  private readonly ttlMs: number;

  constructor(
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    @Inject(LLM_PROVIDER)
    private readonly llmProvider: LlmProvider,
    private readonly llmCacheRepository: LlmCacheRepository,
    private readonly configService: ConfigService,
  ) {
    this.similarityThreshold = parseFloat(
      this.configService.get('CACHE_SIMILARITY_THRESHOLD', '0.92'),
    );

    this.ttlMs = parseInt(
      this.configService.get('CACHE_TTL_MS', '86400000'),
      10,
    );
  }

  async getCompletion(prompt: string): Promise<SemanticCacheResult> {
    const embedding = await this.embeddingProvider.embed(prompt);

    const cached = await this.llmCacheRepository.findSimilar(
      embedding,
      this.similarityThreshold,
    );

    if (cached) {
      this.logger.log(
        `Semantic cache hit (similarity: ${cached.similarity.toFixed(4)})`,
      );

      return {
        response: cached.response,
        cacheHit: true,
        similarity: cached.similarity,
      };
    }

    this.logger.log('Semantic cache miss — calling LLM');

    const response = await this.llmProvider.complete(prompt);

    await this.llmCacheRepository.save(
      prompt,
      embedding,
      response,
      this.ttlMs,
    );

    return { response, cacheHit: false };
  }
}
