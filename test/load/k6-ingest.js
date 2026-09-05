import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const BATCH = __ENV.BATCH || 'run-1';

export const options = {
  scenarios: {
    ingest: {
      executor: 'constant-arrival-rate',
      rate: parseInt(__ENV.RATE || '200'),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/jobs`,
    JSON.stringify({ type: 'email', payload: { to: 'loadtest@example.com', batch: BATCH } }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'status is 201': (r) => r.status === 201 });
}
