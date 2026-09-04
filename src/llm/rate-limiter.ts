/**
 * Minimal token-bucket rate limiter. Free-tier APIs (Gemini included) cap
 * requests per minute; without this, a burst of llm-inference jobs across
 * WORKER_CONCURRENCY workers will trip 429s instead of failing gracefully
 * into the retry/backoff path that already exists in JobProcessor.
 *
 * Deliberately in-memory and per-process, not shared across worker
 * instances via Redis. That's a real limitation once you run more than one
 * worker process (see the "distributed" note on QueueService) — documented
 * here rather than silently assumed away.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillIntervalMs: number = 60_000,
  ) {
    this.tokens = maxTokens;
    this.lastRefillAt = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillAt;

    if (elapsed >= this.refillIntervalMs) {
      this.tokens = this.maxTokens;
      this.lastRefillAt = now;
    }
  }

  /**
   * Resolves once a request slot is available, waiting out the remainder
   * of the current window if the bucket is empty.
   */
  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens -= 1;
      return;
    }

    const waitMs =
      this.refillIntervalMs - (Date.now() - this.lastRefillAt);

    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(waitMs, 0)),
    );

    this.refill();
    this.tokens = Math.max(this.tokens - 1, 0);
  }
}
