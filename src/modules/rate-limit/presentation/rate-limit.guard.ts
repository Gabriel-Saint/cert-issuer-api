import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RATE_LIMIT_PORT } from '../application/rate-limit.port';
import type { RateLimitPort } from '../application/rate-limit.port';
import {
  RATE_LIMIT_POLICIES,
  type RateLimitPolicyName,
} from '../domain/rate-limit.policy';
import { resolveClientIp } from './client-ip';
import { RATE_LIMIT_METADATA } from './rate-limit.decorator';
import type { MachineAuthenticatedRequest } from '../../machine-auth/presentation/machine-auth.guard';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_PORT) private readonly rateLimit: RateLimitPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policies =
      this.reflector.getAllAndOverride<RateLimitPolicyName[]>(
        RATE_LIMIT_METADATA,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (policies.length === 0) {
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR' });
    }

    const request = context
      .switchToHttp()
      .getRequest<MachineAuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const buckets = policies.map((policy) => ({
      key: this.bucketKey(policy, request),
      ...RATE_LIMIT_POLICIES[policy],
    }));

    let decision;
    try {
      decision = await this.rateLimit.consume(buckets);
    } catch {
      throw new HttpException(
        { code: 'DEPENDENCY_UNAVAILABLE', retryAfterSeconds: 1 },
        503,
      );
    }

    response.setHeader('RateLimit-Limit', String(decision.limit));
    response.setHeader('RateLimit-Remaining', String(decision.remaining));
    response.setHeader('RateLimit-Reset', String(decision.resetSeconds));
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds: decision.retryAfterSeconds,
          limit: decision.limit,
          remaining: decision.remaining,
          resetSeconds: decision.resetSeconds,
        },
        429,
      );
    }
    return true;
  }

  private bucketKey(
    policy: RateLimitPolicyName,
    request: MachineAuthenticatedRequest,
  ): string {
    if (policy === 'private' || policy === 'mutation') {
      const integrationId = request.machineIntegration?.id;
      if (!integrationId) {
        throw new HttpException(
          { code: 'DEPENDENCY_UNAVAILABLE', retryAfterSeconds: 1 },
          503,
        );
      }
      return `${policy}:${integrationId}`;
    }
    return `${policy}:${resolveClientIp(request)}`;
  }
}

export type RateLimitedRequest = Request;
