import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicyName } from '../domain/rate-limit.policy';

export const RATE_LIMIT_METADATA = 'rate_limit_policies';

export const RateLimit = (...policies: RateLimitPolicyName[]) =>
  SetMetadata(RATE_LIMIT_METADATA, policies);
