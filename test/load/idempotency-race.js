// test/load/idempotency-race.js
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '500', 10);
const key = `race-${Date.now()}`;

async function fire() {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', payload: { to: 'race@example.com' }, idempotencyKey: key }),
  });
  const body = await res.json();
  return { status: res.status, id: body.id, ms: performance.now() - start };
}

async function main() {
  console.log(`Firing ${CONCURRENCY} concurrent requests with idempotencyKey=${key}`);
  const results = await Promise.all(Array.from({ length: CONCURRENCY }, fire));

  const ids = new Set(results.map((r) => r.id));
  const statuses = new Set(results.map((r) => r.status));
  const times = results.map((r) => r.ms).sort((a, b) => a - b);

  console.log(`Distinct job IDs returned: ${ids.size} (expect 1)`);
  console.log(`Distinct HTTP status codes: ${[...statuses]} (expect only 201)`);
  console.log(`Response time — min ${times[0].toFixed(1)}ms, median ${times[Math.floor(times.length/2)].toFixed(1)}ms, max ${times[times.length-1].toFixed(1)}ms`);
  console.log(`\nVerify in DB: SELECT count(*) FROM jobs WHERE "idempotencyKey" = '${key}';  -- expect 1`);
}
main();