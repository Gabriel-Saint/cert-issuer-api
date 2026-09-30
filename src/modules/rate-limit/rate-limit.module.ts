import { Global, Module } from '@nestjs/common';
import { RATE_LIMIT_PORT } from './application/rate-limit.port';
import { PrismaRateLimitStore } from './infrastructure/prisma-rate-limit.store';
import { RateLimitGuard } from './presentation/rate-limit.guard';

@Global()
@Module({
  providers: [
    PrismaRateLimitStore,
    RateLimitGuard,
    { provide: RATE_LIMIT_PORT, useExisting: PrismaRateLimitStore },
  ],
  exports: [RateLimitGuard, RATE_LIMIT_PORT],
})
export class RateLimitModule {}
