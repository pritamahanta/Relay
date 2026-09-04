-- Enables the pgvector extension so the llm_cache_entries table can store
-- and query embedding vectors natively. Mounted into Postgres's
-- /docker-entrypoint-initdb.d/ so it runs once on first container boot.
CREATE EXTENSION IF NOT EXISTS vector;
