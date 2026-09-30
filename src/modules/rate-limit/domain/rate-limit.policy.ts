export type RateLimitPolicyName =
  'private' | 'mutation' | 'publicVerify' | 'fileCheck';

export interface TokenBucketPolicy {
  limitPerMinute: number;
  burst: number;
}

export const RATE_LIMIT_POLICIES: Record<
  RateLimitPolicyName,
  TokenBucketPolicy
> = {
  private: { limitPerMinute: 600, burst: 30 },
  mutation: { limitPerMinute: 60, burst: 5 },
  publicVerify: { limitPerMinute: 120, burst: 30 },
  fileCheck: { limitPerMinute: 10, burst: 2 },
};

export function refillTokens(input: {
  storedTokens: number;
  elapsedSeconds: number;
  burst: number;
  limitPerMinute: number;
}): number {
  const elapsed = Math.max(0, input.elapsedSeconds);
  const refillPerSecond = input.limitPerMinute / 60;
  return Math.min(input.burst, input.storedTokens + elapsed * refillPerSecond);
}

export function retryAfterSeconds(
  tokens: number,
  limitPerMinute: number,
): number {
  if (tokens >= 1) {
    return 0;
  }
  const refillPerSecond = limitPerMinute / 60;
  return Math.max(1, Math.ceil((1 - tokens) / refillPerSecond));
}

export function resetSeconds(
  tokens: number,
  burst: number,
  limitPerMinute: number,
): number {
  const refillPerSecond = limitPerMinute / 60;
  const missing = Math.max(0, burst - tokens);
  return Math.max(0, Math.ceil(missing / refillPerSecond));
}
