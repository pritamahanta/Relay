# Load Test Results

## Test 1 — API Ingestion Throughput

### Purpose
Establishes the API's raw request-handling capacity — how fast `POST /jobs`
accepts and persists a job (DB insert + Redis enqueue) under sustained load,
independent of how fast the worker can process the resulting jobs. This is
an ingestion-only measurement; it does not indicate end-to-end processing
throughput (see Test 2, pending).

### Method
k6 with a `constant-arrival-rate` executor (open-model load generation, not
a closed loop of workers repeating request→wait→repeat) to avoid
coordinated omission — an open model won't throttle its own arrival rate
under load, so latency numbers reflect real behavior instead of being
self-limited by the test.

```bash
docker run --rm --network host -i grafana/k6 run \
  --env BASE_URL=http://localhost:3000 --env RATE=750 --env DURATION=60s --env BATCH=ingest-1 \
  - < test/load/k6-ingest.js
```

- Tool: k6
- Duration: 60s
- Endpoint: `POST /jobs`
- Payload: `email` job type
- Test machine: local Docker environment

### Results

| Metric | Value |
|---|---:|
| Target rate | 750 req/s |
| Actual rate | 749.99 req/s |
| Total requests | 45,001 |
| HTTP error rate | 0% |
| Dropped iterations | 0 |
| p50 latency | 2.18 ms |
| p90 latency | 3.03 ms |
| p95 latency | 4.01 ms |
| Max latency | 48.35 ms |

### Analysis
0% error rate and 0 dropped iterations at the full target rate confirm the
API layer itself (validation, DB insert, Redis enqueue) does not bottleneck
at 750 req/s — request handling stays in single-digit milliseconds at p95.
The gap between p95 (4.01ms) and max (48.35ms) is expected tail variance
under sustained concurrent load and is not a cause for concern on its own.

This result covers ingestion only. It says nothing about how quickly the
45,001 submitted jobs are actually processed to completion — that number
depends on worker concurrency and job execution time, not on how fast the
API accepts requests, and is measured separately in Test 2.

### Conclusion
Sustained 750 job submissions/sec for 60 seconds with 0% HTTP errors and
~4ms p95 latency at the API layer.


## Test 2 — Idempotency Race at Scale

### Purpose
Proves exactly-once job creation under real concurrent duplicate submissions —
not just the 2-request case already covered by the e2e test suite
(`test/jobs.e2e-spec.ts`), but hundreds to thousands of simultaneous requests
carrying the same `idempotencyKey`.

### Method
`test/load/idempotency-race.js` fires N concurrent `POST /jobs` requests, all
with an identical `idempotencyKey`, directly against a running API instance
(worker not required — the idempotency check happens entirely at the
DB-insert layer in `JobsService.createJob`, before a job is ever queued).
For each request it records the HTTP status and returned job ID, then reports
how many distinct job IDs came back. A passing run returns exactly 1 distinct
ID and only `201` responses across all N requests.

Run at three concurrency levels:
```bash
node test/load/idempotency-race.js
CONCURRENCY=1000 node test/load/idempotency-race.js
CONCURRENCY=2000 node test/load/idempotency-race.js
```

Each result was independently verified against the database:
```sql
SELECT count(*) FROM jobs WHERE "idempotencyKey" = '<key>';
```

### Results

| Concurrency | Distinct job IDs | HTTP statuses | Min / median / max response time | DB row count |
|---:|---:|---|---|---:|
| 500  | 1 | 201 only | 458.3ms / 726.7ms / 764.7ms | 1 |
| 1000 | 1 | 201 only | 357.5ms / 473.2ms / 652.5ms | 1 |
| 2000 | 1 | 201 only | 532.4ms / 763.6ms / 891.8ms | 1 |

### Analysis
Exactly one job was created in all three runs, confirmed at both the
application layer (distinct ID count) and the database layer (row count) —
the unique-constraint-catch-and-refetch logic in `JobsService.createJob`
held under real concurrent load, not just a lucky race.

Latency is elevated (350–900ms for a single-row insert) and does not scale
linearly with concurrency because only one request per batch wins the
insert; every other request hits the Postgres `23505` unique-violation
error and pays for a second sequential round-trip
(`findByIdempotencyKey`) to fetch the winning job before responding — so
most requests in each batch are paying for two DB queries under
contention for the same connection pool, not one.

### Conclusion
Verified exactly-once job creation under 500, 1,000, and 2,000 concurrent
duplicate requests with the same idempotency key — 1 job created in all
cases, confirmed via database row count.

