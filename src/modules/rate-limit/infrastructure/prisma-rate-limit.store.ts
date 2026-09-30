import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import {
  RateLimitBucketSpec,
  RateLimitDecision,
  RateLimitPort,
} from '../application/rate-limit.port';
import {
  refillTokens,
  resetSeconds,
  retryAfterSeconds,
} from '../domain/rate-limit.policy';

interface StoredBucket {
  tokens: string;
  updatedAt: Date;
}

@Injectable()
export class PrismaRateLimitStore implements RateLimitPort {
  constructor(private readonly prisma: PrismaService) {}

  async consume(buckets: RateLimitBucketSpec[]): Promise<RateLimitDecision> {
    if (buckets.length === 0) {
      throw new Error('At least one rate-limit bucket is required');
    }

    return this.prisma.$transaction(async (transaction) => {
      const evaluated = [];
      for (const bucket of buckets) {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${bucket.key})::bigint)
        `;
        const rows = await transaction.$queryRaw<StoredBucket[]>`
          SELECT tokens::text AS tokens, "updatedAt"
          FROM "RateLimitBucket"
          WHERE "bucketKey" = ${bucket.key}
        `;
        const now = new Date();
        const stored = rows[0];
        const elapsedSeconds = stored
          ? (now.getTime() - stored.updatedAt.getTime()) / 1000
          : 0;
        const available = stored
          ? refillTokens({
              storedTokens: Number(stored.tokens),
              elapsedSeconds,
              burst: bucket.burst,
              limitPerMinute: bucket.limitPerMinute,
            })
          : bucket.burst;
        evaluated.push({ bucket, available, now });
      }

      const allowed = evaluated.every((item) => item.available >= 1);
      const persisted = evaluated.map((item) => {
        const tokens = allowed ? item.available - 1 : item.available;
        return { ...item, tokens };
      });

      for (const item of persisted) {
        const expiresAt = new Date(item.now.getTime() + 24 * 60 * 60 * 1000);
        const tokens = item.tokens.toFixed(4);
        await transaction.$executeRaw`
          INSERT INTO "RateLimitBucket" ("bucketKey", tokens, "updatedAt", "expiresAt")
          VALUES (${item.bucket.key}, ${tokens}::numeric, ${item.now}, ${expiresAt})
          ON CONFLICT ("bucketKey") DO UPDATE
          SET tokens = ${tokens}::numeric,
              "updatedAt" = ${item.now},
              "expiresAt" = ${expiresAt}
        `;
      }

      const strictest = persisted.reduce((current, item) =>
        item.tokens / item.bucket.burst < current.tokens / current.bucket.burst
          ? item
          : current,
      );
      const retryAfter = allowed
        ? 0
        : Math.max(
            ...persisted
              .filter((item) => item.tokens < 1)
              .map((item) =>
                retryAfterSeconds(item.tokens, item.bucket.limitPerMinute),
              ),
          );

      return {
        allowed,
        limit: strictest.bucket.limitPerMinute,
        remaining: Math.max(0, Math.floor(strictest.tokens)),
        resetSeconds: resetSeconds(
          strictest.tokens,
          strictest.bucket.burst,
          strictest.bucket.limitPerMinute,
        ),
        retryAfterSeconds: retryAfter,
      };
    });
  }
}
