-- Semantic cache for the llm-inference job type.
--
-- This table is managed via raw SQL rather than a TypeORM entity because
-- TypeORM has no first-class support for the pgvector `vector` column type
-- or its similarity operators (<=>, <->). Rather than fight the ORM with an
-- `as any` type cast that could silently break on a TypeORM upgrade, all
-- reads/writes against this table go through raw queries in
-- LlmCacheRepository. Every other table in this project stays on the
-- normal TypeORM/synchronize path — this is a deliberate, scoped exception,
-- not a pattern to spread elsewhere.
--
-- Dimension is 768, not the model's default 3072, via Gemini's Matryoshka
-- Representation Learning (MRL) truncation — Google's own guidance lists
-- 768 as a supported, still-high-quality output size, and a smaller vector
-- keeps the ANN index compact and lookups fast for a project at this scale.
CREATE TABLE IF NOT EXISTS llm_cache_entries (
  id UUID PRIMARY KEY,
  prompt TEXT NOT NULL,
  embedding VECTOR(768) NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  expires_at TIMESTAMP NOT NULL
);

-- IVFFlat approximate-nearest-neighbor index for cosine similarity search.
-- lists = 100 is a reasonable starting point for a low-volume cache table;
-- pgvector's own guidance is roughly sqrt(row_count) — revisit if this
-- table grows past a few tens of thousands of rows.
CREATE INDEX IF NOT EXISTS llm_cache_embedding_idx
  ON llm_cache_entries
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS llm_cache_expires_at_idx
  ON llm_cache_entries (expires_at);
