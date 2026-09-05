# Load Test Results

## Test 1 — API Ingestion Throughput

### Configuration
- Tool: k6
- Duration: 60s
- Endpoint: POST /jobs
- Payload: email job
- Test machine: Local Docker environment

### Results
- Target rate: 750 req/s
- Actual rate: 749.99 req/s
- Total requests: 45,001
- HTTP error rate: 0%
- Dropped iterations: 0
- p50: 2.18 ms
- p90: 3.03 ms
- p95: 4.01 ms
- Max: 48.35 ms

### Conclusion
Sustained 750 job submissions/sec for 60 seconds with 0% HTTP errors and ~4 ms p95 latency.