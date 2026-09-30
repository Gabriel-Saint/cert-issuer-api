import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { PrismaModule } from './infrastructure/persistence/prisma.module';
import { MachineAuthModule } from './modules/machine-auth/machine-auth.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { ProblemDetailsFilter } from './shared/presentation/problem-details.filter';
import { RequestIdMiddleware } from './shared/presentation/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MachineAuthModule,
    RateLimitModule,
    CertificatesModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
