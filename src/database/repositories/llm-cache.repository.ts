import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

export interface LlmCacheHit {
  id: string;
  prompt: string;
  response: string;
  similarity: number;
}

// See infra/init-db/02-llm-cache-table.sql for why this table is managed
// via raw SQL instead of a TypeORM @Entity: TypeORM has no first-class
// support for the pgvector `vector` column type or its distance operators.
@Injectable()
export class LlmCacheRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Returns the closest non-expired cache entry whose cosine similarity to
   * `embedding` is at or above `threshold`, or null on a cache miss.
   * pgvector's `<=>` operator returns cosine *distance* (0 = identical),
   * so similarity is computed as `1 - distance`.
   */
  async findSimilar(
    embedding: number[],
    threshold: number,
  ): Promise<LlmCacheHit | null> {
    const vectorLiteral = this.toVectorLiteral(embedding);

    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          prompt,
          response,
          1 - (embedding <=> $1::vector) AS similarity
        FROM llm_cache_entries
        WHERE expires_at > now()
          AND 1 - (embedding <=> $1::vector) >= $2
        ORDER BY embedding <=> $1::vector ASC
        LIMIT 1
      `,
      [vectorLiteral, threshold],
    );

    if (rows.length === 0) {
      return null;
    }

    return {
      id: rows[0].id,
      prompt: rows[0].prompt,
      response: rows[0].response,
      similarity: parseFloat(rows[0].similarity),
    };
  }

  async save(
    prompt: string,
    embedding: number[],
    response: string,
    ttlMs: number,
  ): Promise<void> {
    const vectorLiteral = this.toVectorLiteral(embedding);

    await this.dataSource.query(
      `
        INSERT INTO llm_cache_entries
          (id, prompt, embedding, response, expires_at)
        VALUES
          ($1, $2, $3::vector, $4, now() + ($5 || ' milliseconds')::interval)
      `,
      [randomUUID(), prompt, vectorLiteral, response, ttlMs],
    );
  }

  /**
   * Deletes expired entries. Not wired to a scheduler yet — call this from
   * a cron job or a periodic BullMQ job if the cache table grows large
   * enough for that to matter. Noted here rather than silently omitted.
   */
  async purgeExpired(): Promise<number> {
    const result = await this.dataSource.query(
      `DELETE FROM llm_cache_entries WHERE expires_at <= now()`,
    );

    return result[1] ?? 0;
  }
}
