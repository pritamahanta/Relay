import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows up to maxTokens acquisitions immediately', async () => {
    const limiter = new RateLimiter(3, 60_000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    // All three resolved without needing to advance fake timers.
    expect(true).toBe(true);
  });

  it('blocks until the window refills once the bucket is empty', async () => {
    const limiter = new RateLimiter(1, 60_000);

    await limiter.acquire();

    let resolved = false;
    limiter.acquire().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    await jest.advanceTimersByTimeAsync(60_000);

    expect(resolved).toBe(true);
  });
});
