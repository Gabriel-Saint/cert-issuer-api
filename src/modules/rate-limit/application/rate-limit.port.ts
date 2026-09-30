export const RATE_LIMIT_PORT = Symbol('RATE_LIMIT_PORT');

export interface RateLimitBucketSpec {
  key: string;
  limitPerMinute: number;
  burst: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

export interface RateLimitPort {
  consume(buckets: RateLimitBucketSpec[]): Promise<RateLimitDecision>;
}
