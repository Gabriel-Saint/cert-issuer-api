import {
  refillTokens,
  resetSeconds,
  retryAfterSeconds,
} from './rate-limit.policy';

describe('token bucket policy', () => {
  it('refills up to the burst and never above it', () => {
    expect(
      refillTokens({
        storedTokens: 1,
        elapsedSeconds: 30,
        burst: 5,
        limitPerMinute: 60,
      }),
    ).toBe(5);
  });

  it('calculates retry and reset from the refill rate', () => {
    expect(retryAfterSeconds(0.5, 60)).toBe(1);
    expect(retryAfterSeconds(2, 60)).toBe(0);
    expect(resetSeconds(3, 5, 60)).toBe(2);
  });
});
