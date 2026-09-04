import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../database/database.module';
import { LlmCacheRepository } from '../database/repositories/llm-cache.repository';

import { EMBEDDING_PROVIDER } from './interfaces/embedding-provider.interface';
import { LLM_PROVIDER } from './interfaces/llm-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { SemanticCacheService } from './semantic-cache.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    LlmCacheRepository,
    GeminiProvider,
    { provide: EMBEDDING_PROVIDER, useExisting: GeminiProvider },
    { provide: LLM_PROVIDER, useExisting: GeminiProvider },
    SemanticCacheService,
  ],
  exports: [SemanticCacheService],
})
export class LlmModule {}
