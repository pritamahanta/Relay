# Distributed Job Queue System

Asynchronous job processing with NestJS, PostgreSQL, Redis, BullMQ, and an optional Gemini-backed LLM inference workflow with semantic caching.

## Features

- Separate API and worker processes for independent scaling.
- BullMQ main queue backed by Redis.
- Job priorities: `CRITICAL` (1), `HIGH` (5), `NORMAL` (10), and `LOW` (20).
- Delayed jobs with a delay in milliseconds.
- Retry with exponential backoff: `1000 * 2^attemptNumber` milliseconds.
- Dead-letter queue after `maxAttempts` is exhausted.
- Application and database-level idempotency using `idempotencyKey`.
- PostgreSQL persistence for job state, attempts, errors, timestamps, and results.
- 60-second execution timeout using `Promise.race()`.
- Configurable worker concurrency.
- DTO validation with `class-validator`; unknown request fields are rejected.
- Structured logging through NestJS and Pino dependencies.
- `llm-inference` jobs using Gemini embeddings and text generation.
- Semantic LLM cache using pgvector cosine similarity, TTL expiration, and an IVFFlat index.
- In-memory Gemini rate limiting at 12 requests per 60-second window per worker process.
- Graceful worker shutdown through NestJS shutdown hooks.

## Architecture

```text
Client -> NestJS API -> PostgreSQL (job state)
                   -> Redis/BullMQ (main queue)

Worker <- Redis/BullMQ
   |-> PostgreSQL (status, attempts, result, errors)
   |-> Gemini API (llm-inference jobs)
   `-> PostgreSQL/pgvector (semantic cache)
```

The API creates the PostgreSQL record before enqueueing the BullMQ job. The worker increments attempts, marks the job as processing, executes it, and marks it completed, failed, or dead-lettered.

## Directory Structure

```text
src/
  llm/
    llm.module.ts
    rate-limiter.spec.ts
    rate-limiter.ts
    semantic-cache.service.spec.ts
    semantic-cache.service.ts
    interfaces/
      embedding-provider.interface.ts
      llm-provider.interface.ts
    providers/
      gemini.provider.ts
  database/
    repositories/
      llm-cache.repository.ts
infra/
  init-db/
    02-llm-cache-table.sql
```

## Features by Job Type

### Generic jobs

Any type other than `email` and `llm-inference` uses the default processor. The payload must be an object. Set `payload.fail` to `true` to intentionally fail a job during local retry/DLQ testing.

### `email`

Logs the recipient in `payload.to` and simulates email processing for one second.

### `llm-inference`

Requires a non-empty `payload.prompt`. The worker:

1. Generates a 768-dimensional Gemini embedding.
2. Searches non-expired pgvector cache entries using cosine similarity.
3. Returns the cached response when similarity meets `CACHE_SIMILARITY_THRESHOLD`.
4. Calls Gemini on a cache miss and stores the response for `CACHE_TTL_MS`.

The job result contains `response`, `cacheHit`, and, for cache hits, `similarity`.

## LLM Semantic Cache

The `llm-inference` job type is implemented by `src/llm/`. It requires a non-empty `payload.prompt`. The Gemini provider first creates a 768-dimensional embedding, then `LlmCacheRepository` searches non-expired `llm_cache_entries` rows with pgvector cosine similarity. A cache entry is used when its similarity is at least `CACHE_SIMILARITY_THRESHOLD`; otherwise, the provider requests a Gemini completion and stores the prompt, embedding, response, and expiration time using `CACHE_TTL_MS`. The cache table and its IVFFlat cosine index are created by `infra/init-db/02-llm-cache-table.sql`.

Both embedding and completion requests acquire a slot from the in-memory token-bucket limiter in `src/llm/rate-limiter.ts`. Each worker process has 12 tokens per 60-second window; when the bucket is empty, the request waits for the current window to refill. The limiter is not shared between worker processes.

Submit an `llm-inference` job with:

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "llm-inference",
    "payload": { "prompt": "Summarize distributed queues" }
  }'
```

## API

### Create a job

`POST /jobs`

```json
{
  "type": "llm-inference",
  "payload": { "prompt": "Summarize distributed queues" },
  "idempotencyKey": "summary-123",
  "priority": 5,
  "maxAttempts": 3,
  "delay": 5000
}
```

Fields:

| Field | Type | Required | Description |
|---|---|---:|---|
| `type` | string | yes | Job type identifier. |
| `payload` | object | yes | Data passed to the processor. |
| `idempotencyKey` | string | no | Returns the existing job for repeated submissions. |
| `priority` | `1 \| 5 \| 10 \| 20` | no | Defaults to `10`; lower values run first. |
| `maxAttempts` | positive integer | no | Defaults to `10`. |
| `delay` | non-negative integer | no | Delay before queue processing, in milliseconds. |

Returns HTTP `201` with the job record:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "llm-inference",
  "status": "QUEUED",
  "priority": 5,
  "attempts": 0,
  "maxAttempts": 3,
  "createdAt": "2026-08-30T10:15:30.000Z",
  "updatedAt": "2026-08-30T10:15:30.000Z",
  "processedAt": null,
  "completedAt": null,
  "error": null,
  "result": null
}
```

### Get job status

`GET /jobs/:id`

The response includes `id`, `type`, `status`, `priority`, `attempts`, `maxAttempts`, timestamps, `error`, and `result`.

## Job Lifecycle

```text
QUEUED -> PROCESSING -> COMPLETED
                    \\-> FAILED -> retry with backoff -> PROCESSING
                              \\-> DEAD_LETTER
```

The execution timeout is 60,000 ms. `Promise.race()` rejects on timeout but cannot cancel the underlying promise, so timed-out work may continue in the background.

## Reliability

- Idempotent job submission is race-safe against concurrent duplicate requests. `JobsService.createJob` handles the PostgreSQL unique-constraint violation on `idempotencyKey` and returns the job created by the winning request.
- `WorkerService` listens for BullMQ `failed` events and reconciles jobs that stall or crash while marked `PROCESSING`, including retry or DLQ handling when they never reach `JobProcessor`'s own retry/DLQ logic.
- Job timeouts do not cancel the underlying work. The 60-second timeout rejects the job's `Promise.race()`, but the original promise may continue running in the background.

## Local Development

### Prerequisites

- Node.js 24+
- pnpm 9+
- Docker and Docker Compose
- `GEMINI_API_KEY` for `llm-inference` jobs

### Setup

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm run start:dev
pnpm run start:worker:dev
```

The API listens on `http://localhost:3000`. Run the API and worker commands in separate terminals. The development compose file exposes PostgreSQL on `5432` and Redis on `6379` and uses the `pgvector/pgvector:pg16` image.

The PostgreSQL initialization scripts create the pgvector extension and `llm_cache_entries` table. They run only when PostgreSQL initializes a new data volume; remove the development volume before reinitializing it.

## Configuration

Defaults are defined in the application code. Set these variables as needed:

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `3000` | API |
| `DB_HOST` | `localhost` | API and worker |
| `DB_PORT` | `5432` | API and worker |
| `DB_USERNAME` | `postgres` | API and worker |
| `DB_PASSWORD` | `postgres` | API and worker |
| `DB_NAME` | `job_queue` | API and worker |
| `DB_SYNC` | `false` | API and worker |
| `DB_LOGGING` | `false` | API and worker |
| `REDIS_HOST` | `localhost` | API and worker |
| `REDIS_PORT` | `6379` | API and worker |
| `WORKER_CONCURRENCY` | `5` | Worker |
| `GEMINI_API_KEY` | empty | Worker |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Worker |
| `GEMINI_COMPLETION_MODEL` | `gemini-2.5-flash` | Worker |
| `CACHE_SIMILARITY_THRESHOLD` | `0.92` | Worker |
| `CACHE_TTL_MS` | `86400000` | Worker |

The Gemini provider uses the Google Generative Language REST API. Its rate limiter is local to each worker process and is not shared through Redis.

## Database and Queue Details

- PostgreSQL stores the `jobs` table through TypeORM.
- Job payloads and results use PostgreSQL `jsonb`.
- The `jobs` table has indexes for `(status, priority)` and non-null idempotency keys.
- Redis contains the BullMQ `main-queue` and `dead-letter-queue` queues.
- Semantic cache entries are managed with raw SQL because TypeORM does not provide first-class pgvector support.
- Cache embeddings use `VECTOR(768)` and an IVFFlat cosine index.
- Expired cache entries can be removed with `LlmCacheRepository.purgeExpired()`; no scheduler currently calls it.

## Commands

```bash
pnpm run build
pnpm run start:dev
pnpm run start:worker:dev
pnpm run lint
pnpm run format
pnpm run test
pnpm run test:watch
pnpm run test:cov
pnpm run test:e2e
```

TypeORM commands use `src/database/data-source.ts`:

```bash
pnpm run migration:generate -- src/database/migrations/Name
pnpm run migration:run
pnpm run migration:revert
pnpm run migration:run:prod
```

## Testing

The `test/jobs.e2e-spec.ts` suite covers job creation and retrieval, request validation, sequential idempotency, and a real concurrent-request race test for duplicate idempotency keys. CI runs these e2e tests against real PostgreSQL and Redis service containers defined in `.github/workflows/ci.yml`.

## Docker Production Stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

The production compose file runs PostgreSQL, Redis, the API, and the worker. The API is exposed on port `3000`. Both application containers wait for healthy PostgreSQL and Redis services. The worker receives Gemini and cache configuration from the compose environment, including `${GEMINI_API_KEY}`.

## Technology Stack

| Area | Technology |
|---|---|
| Runtime | Node.js 24 |
| Framework | NestJS 11 |
| Language | TypeScript 5.7 |
| Database | PostgreSQL 16 with pgvector |
| Vector search | pgvector |
| ORM | TypeORM 0.3 |
| Queue | BullMQ 5 with Redis 7 |
| Redis client | ioredis 5 |
| LLM API and embeddings | Google Gemini REST API |
| Validation | class-validator and class-transformer |
| Logging | nestjs-pino, Pino, pino-pretty |
| Testing | Jest 30, Supertest |
| Linting and formatting | oxlint, Prettier |
| Package manager | pnpm 9 |

## License

This project is private and unlicensed. See [LICENSE](LICENSE).
