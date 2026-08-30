# Distributed Job Queue System

A production-ready asynchronous job queue system built with NestJS, PostgreSQL, Redis, and BullMQ. Supports job prioritization, retry with exponential backoff, idempotent submissions, and graceful shutdown.

## Architecture

```
                 ┌──────────────┐
                 │    Client    │
                 └──────┬───────┘
                        │ HTTP
                        ▼
                 ┌──────────────┐
                 │  NestJS API  │
                 └──────┬───────┘
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
       ┌────────────┐      ┌─────────────┐
       │ PostgreSQL │      │ Redis/BullMQ│
       │ Job State  │      │    Queue    │
       └──────▲─────┘      └──────┬──────┘
              │                   │
              │ status            │ consume
              │ updates            ▼
              │            ┌──────────────┐
              └────────────│    Worker    │
                           │              │
                           │ JobProcessor │
                           │ Retry / DLQ  │
                           │ Timeout      │
                           └──────────────┘
```

## Components

### API Server (`src/api/`)
- **JobsController**: HTTP endpoints for creating and querying jobs
- **JobsService**: Business logic for job creation, idempotency checking, and status retrieval
- **CreateJobDto**: Input validation for job submissions
- **JobResponseDto**: Structured response format

### Database (`src/database/`)
- **JobEntity**: Represents a job record in PostgreSQL, including status, attempts, priority, and idempotency key
- **JobRepository**: Data access layer providing CRUD operations and status transitions via TypeORM

### Queue Service (`src/queue/`)
- **QueueService**: Manages BullMQ queues (main queue and dead-letter queue)
- Handles job enqueueing with priority and delay
- Implements exponential backoff retry calculation
- Manages dead-letter queue transitions

### Worker (`src/worker/`)
- **WorkerService**: Lifecycle management for the worker process with shutdown hooks
- **JobProcessor**: Executes jobs with built-in timeout enforcement
- Tracks execution attempts and status transitions
- Routes failed jobs to retry or dead-letter queue

## Job Lifecycle

### Success Path
```
QUEUED → PROCESSING → COMPLETED
```

A job begins in the QUEUED state, transitions to PROCESSING when the worker picks it up, and moves to COMPLETED upon successful execution.

### Failure and Retry Path
```
PROCESSING → FAILED → (retry with backoff) → PROCESSING → ...
```

When a job fails and attempts remain, it is rescheduled with exponential backoff delay and retried.

### Dead-Letter Queue (DLQ) Path
```
PROCESSING → FAILED → (max attempts exceeded) → DEAD_LETTER
```

After exhausting all retry attempts, the job is moved to the dead-letter queue for inspection and manual intervention.

## Retry Strategy & Exponential Backoff

Retry logic uses **exponential backoff** with the formula:

```
delay_ms = 1000 * 2^attemptNumber
```

Examples:
- Attempt 0 (1st failure): 1,000 ms delay
- Attempt 1 (2nd failure): 2,000 ms delay
- Attempt 2 (3rd failure): 4,000 ms delay
- Attempt 3 (4th failure): 8,000 ms delay

**Default max attempts**: 10 (configurable per job via `maxAttempts` field)

## Attempt Tracking

Each job tracks:
- **attempts**: Current execution attempt count (incremented before each execution attempt)
- **maxAttempts**: Maximum number of retry attempts (default: 10)

The worker increments `attempts` at the start of each execution. If execution fails and `attempts < maxAttempts`, the job is requeued with backoff. Otherwise, it moves to the dead-letter queue.

## Dead-Letter Queue (DLQ)

Failed jobs that exhaust all retry attempts are moved to a separate dead-letter queue in Redis for inspection. They are also persisted in PostgreSQL with status `DEAD_LETTER` and the error message. This allows manual inspection, debugging, and optional manual reprocessing.

## Idempotency

Idempotent job submission is enforced at the **application and database levels**:

- **Application level**: When a job is submitted with an `idempotencyKey`, the JobsService checks for an existing job with that key before creating a new one. If found, it returns the existing job instead of creating a duplicate.
- **Database level**: The `idempotencyKey` column has a unique index (`WHERE "idempotencyKey" IS NOT NULL`), preventing duplicate entries even in concurrent scenarios.

This guarantees that the same logical work (identified by an idempotency key) will not be queued multiple times.

## Job Priority

Jobs support four priority levels defined in `JobPriority` enum:

| Priority  | Value |
|-----------|-------|
| CRITICAL  | 1     |
| HIGH      | 5     |
| NORMAL    | 10    |
| LOW       | 20    |

Lower numeric values indicate higher priority. BullMQ processes jobs in priority order.

## Job Execution Timeout

Each job has a **60-second execution timeout** (`JOB_TIMEOUT = 60,000 ms`) enforced via `Promise.race()`.

**Important limitation**: The timeout using `Promise.race()` does not cancel the underlying Promise. If a job exceeds the timeout, a rejection is thrown and the job is marked as failed, but the underlying work continues to execute in the background. This is a fundamental limitation of Promise-based timeouts in JavaScript.

Example:
- Job submitted with `delay: 5000` → starts execution after 5 seconds
- Job execution begins → timeout starts counting
- If job takes > 60 seconds → timeout error is thrown → job marked as failed
- Underlying promise continues executing in background (no cancellation)

## Worker Concurrency

The worker process handles multiple jobs concurrently. The concurrency level is configurable via the `WORKER_CONCURRENCY` environment variable (default: 5 concurrent jobs).

**Separate processes**: The API server and worker are separate processes for resource isolation and independent scaling:
- **API process**: Handles HTTP requests and job enqueueing
- **Worker process**: Processes jobs from the queue

This separation allows:
- Independent scaling of job intake vs. processing capacity
- Fault isolation (worker crashes don't bring down the API)
- Dedicated resource allocation for long-running job execution

## Graceful Shutdown

Both API and worker processes implement graceful shutdown:

- **API process**: Uses NestJS built-in shutdown hooks
- **Worker process**: Calls `app.enableShutdownHooks()` to listen for SIGTERM/SIGINT, allowing:
  - Worker to stop accepting new jobs
  - Ongoing jobs to complete or timeout
  - Connections (database, Redis) to close cleanly

## Repository Pattern

The `JobRepository` provides an abstraction layer over TypeORM and PostgreSQL:

- Encapsulates all database queries and mutations
- Provides named methods for domain operations (`markAsCompleted`, `markAsProcessing`, etc.)
- Centralizes job persistence logic
- Enables testing via mock repository implementations

## Directory Structure

```
distributed-job-queue/
├── src/
│   ├── api/                      # HTTP API layer
│   │   ├── jobs.controller.ts    # REST endpoints
│   │   ├── jobs.service.ts       # Business logic
│   │   ├── jobs.service.spec.ts  # Unit tests
│   │   └── dto/
│   │       ├── create-job.dto.ts
│   │       └── job-response.dto.ts
│   ├── database/                 # Data persistence
│   │   ├── database.module.ts    # TypeORM configuration
│   │   ├── entities/
│   │   │   └── job.entity.ts     # JobEntity (PostgreSQL schema)
│   │   └── repositories/
│   │       └── job.repository.ts # Job CRUD & persistence
│   ├── queue/                    # Job queueing
│   │   ├── queue.module.ts
│   │   └── queue.service.ts      # BullMQ & Redis integration
│   ├── worker/                   # Job execution
│   │   ├── worker.module.ts
│   │   ├── worker.service.ts     # Worker lifecycle
│   │   └── processors/
│   │       ├── job.processor.ts  # Job execution logic
│   │       └── job.processor.spec.ts # Unit tests
│   ├── shared/
│   │   ├── constants.ts          # JOB_TIMEOUT
│   │   └── enums/
│   │       ├── job-status.enum.ts
│   │       └── job-priority.enum.ts
│   ├── app.module.ts             # Root module
│   ├── app.controller.ts
│   ├── app.service.ts
│   ├── main.ts                   # API server entry point
│   └── worker-main.ts            # Worker entry point
├── test/
│   └── jest-e2e.json             # E2E test configuration
├── infra/
│   ├── Dockerfile                # Multi-stage build
│   └── docker-compose.yml        # Production environment
├── docker-compose.dev.yml        # Development environment
├── package.json                  # Dependencies & scripts
└── tsconfig.json                 # TypeScript configuration
```

## Local Development

### Prerequisites
- Node.js 24+ (Alpine compatible)
- pnpm 9+
- Docker & Docker Compose (for PostgreSQL and Redis)

### Setup

1. Install dependencies:
```bash
pnpm install
```

2. Start PostgreSQL and Redis:
```bash
docker-compose -f docker-compose.dev.yml up -d
```

3. In one terminal, start the API server:
```bash
pnpm run start:dev
```

4. In another terminal, start the worker:
```bash
pnpm run start:worker:dev
```

The API will be available at `http://localhost:3000`.

### Development Commands

```bash
# Start API in watch mode
pnpm run start:dev

# Start worker in watch mode
pnpm run start:worker:dev

# Lint code
pnpm run lint

# Format code
pnpm run format

# Run unit tests
pnpm run test

# Run unit tests in watch mode
pnpm run test:watch

# View test coverage
pnpm run test:cov
```

## Docker

### Build

The `infra/Dockerfile` uses a multi-stage build to minimize final image size:
1. **Builder stage**: Installs dependencies and compiles TypeScript to JavaScript
2. **Runner stage**: Uses only production dependencies

```bash
docker build -f infra/Dockerfile -t distributed-job-queue .
```

### Production Deployment with Docker Compose

The `infra/docker-compose.yml` defines four services:

| Service | Purpose |
|---------|---------|
| **postgres** | PostgreSQL 16 database for job persistence |
| **redis** | Redis 7 queue backend for BullMQ |
| **api** | NestJS API server (port 3000) |
| **worker** | Job processing worker (consumer of main queue) |

Start the full stack:
```bash
docker-compose -f infra/docker-compose.yml up -d
```

#### Environment Variables

**API Service**:
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` – PostgreSQL connection
- `REDIS_HOST`, `REDIS_PORT` – Redis connection
- `NODE_ENV` – Set to `production`
- `PORT` – API server port (default: 3000)

**Worker Service**:
- `DB_*` – PostgreSQL connection (same as API)
- `REDIS_HOST`, `REDIS_PORT` – Redis connection
- `WORKER_CONCURRENCY` – Number of concurrent job processors (default: 5)

#### Health Checks

Both PostgreSQL and Redis include health checks. The API and worker depend on their health, ensuring the system is ready before processing requests or jobs.

## REST API

### Create a Job

**Endpoint**: `POST /jobs`

**Request Body**:
```json
{
  "type": "email",
  "payload": {
    "to": "user@example.com",
    "subject": "Welcome",
    "body": "Hello!"
  },
  "idempotencyKey": "unique-key-12345",
  "priority": 5,
  "maxAttempts": 3,
  "delay": 5000
}
```

**Parameters**:
- `type` (string, required): Job type identifier (e.g., `email`)
- `payload` (object, required): Job data passed to the processor
- `idempotencyKey` (string, optional): Unique key for idempotent submissions
- `priority` (number, optional): Priority level (1=CRITICAL, 5=HIGH, 10=NORMAL, 20=LOW). Default: 10
- `maxAttempts` (number, optional): Maximum retry attempts. Default: 10
- `delay` (number, optional): Delay in milliseconds before starting the job

**Response** (HTTP 201):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "email",
  "status": "QUEUED",
  "priority": 5,
  "attempts": 0,
  "maxAttempts": 3,
  "createdAt": "2026-08-30T10:15:30.000Z",
  "updatedAt": "2026-08-30T10:15:30.000Z",
  "processedAt": null,
  "completedAt": null,
  "error": null
}
```

**Example with curl**:
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email",
    "payload": {"to": "user@example.com"},
    "idempotencyKey": "email-12345",
    "priority": 5,
    "maxAttempts": 3
  }'
```

### Get Job Status

**Endpoint**: `GET /jobs/:id`

**Response**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "email",
  "status": "COMPLETED",
  "priority": 5,
  "attempts": 1,
  "maxAttempts": 3,
  "createdAt": "2026-08-30T10:15:30.000Z",
  "updatedAt": "2026-08-30T10:15:35.000Z",
  "processedAt": "2026-08-30T10:15:31.000Z",
  "completedAt": "2026-08-30T10:15:35.000Z",
  "error": null
}
```

**Example with curl**:
```bash
curl http://localhost:3000/jobs/550e8400-e29b-41d4-a716-446655440000
```

## Testing

### Unit Tests

```bash
# Run unit tests
pnpm run test

# Run in watch mode
pnpm run test:watch

# Generate coverage report
pnpm run test:cov
```

**Test Coverage**:
- `jobs.service.spec.ts`: Tests job creation, idempotency detection, and status retrieval
- `job.processor.spec.ts`: Tests job execution, retry logic, and dead-letter queue transitions

**Example Tests**:
- ✅ Creating and enqueueing a job
- ✅ Idempotent job submission (returns existing job)
- ✅ Job status retrieval
- ✅ Successful job completion
- ✅ Retry on failure with remaining attempts
- ✅ Dead-letter queue transition when max attempts exceeded

### E2E Tests

```bash
pnpm run test:e2e
```

E2E tests use the Jest configuration in `test/jest-e2e.json`.

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 24 (Alpine) |
| **Framework** | NestJS | 11.x |
| **Language** | TypeScript | 5.7.x |
| **Database** | PostgreSQL | 16 |
| **ORM** | TypeORM | 0.3.x |
| **Queue** | BullMQ | 5.81.x |
| **Cache/Queue Backend** | Redis | 7 |
| **Redis Client** | ioredis | 5.11.x |
| **Logging** | Pino | 10.x |
| **Package Manager** | pnpm | 9.x |
| **Testing** | Jest | 30.x |
| **Linting** | ESLint | 9.x |
| **Formatting** | Prettier | 3.x |

## License

This project is **private and unlicensed**. All source code and materials are proprietary and confidential. No rights are granted to copy, modify, distribute, or use this software without explicit written permission.

See [LICENSE](LICENSE) for details.
