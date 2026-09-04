const http = require("http");

const TOTAL_JOBS = 10000;
const SUBMIT_CONCURRENCY = 100;
const BASE_URL = "http://localhost:3000";

let nextJob = 0;
let accepted = 0;
let failed = 0;

function submitJob() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      type: "email",
      payload: {
        to: "benchmark@example.com",
        subject: "Throughput Benchmark",
        body: "Synthetic benchmark workload",
      },
    });

    const req = http.request(
      `${BASE_URL}/jobs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();

        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            accepted++;
          } else {
            failed++;
          }

          resolve();
        });
      },
    );

    req.on("error", () => {
      failed++;
      resolve();
    });

    req.write(body);
    req.end();
  });
}

async function submitWorker() {
  while (true) {
    const index = nextJob++;

    if (index >= TOTAL_JOBS) {
      return;
    }

    await submitJob();
  }
}

async function main() {
  console.log(`Submitting ${TOTAL_JOBS} jobs...`);
  console.log(`HTTP concurrency: ${SUBMIT_CONCURRENCY}`);

  const start = process.hrtime.bigint();

  await Promise.all(
    Array.from(
      { length: SUBMIT_CONCURRENCY },
      () => submitWorker(),
    ),
  );

  const elapsedSeconds =
    Number(process.hrtime.bigint() - start) / 1e9;

  console.log("\nResults");
  console.log("-------");
  console.log(`Submitted: ${TOTAL_JOBS}`);
  console.log(`Accepted:  ${accepted}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Time:      ${elapsedSeconds.toFixed(2)}s`);
  console.log(
    `Submission throughput: ${(accepted / elapsedSeconds).toFixed(2)} jobs/sec`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});