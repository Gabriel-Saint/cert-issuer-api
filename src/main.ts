import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { Request, Response } from 'express';
import { RawBodyRequest } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  buildProblem,
  readRequestIdFrom,
  writeProblem,
} from './shared/presentation/problem-details';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(
    json({
      limit: 64 * 1024,
      verify: (request: Request, _response: Response, body: Buffer) => {
        (request as RawBodyRequest<Request>).rawBody = Buffer.from(body);
      },
    }),
  );
  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      next: (error?: unknown) => void,
    ) => {
      const type =
        typeof error === 'object' && error !== null && 'type' in error
          ? (error as { type?: string }).type
          : undefined;
      if (type !== 'entity.too.large' && type !== 'entity.parse.failed') {
        next(error);
        return;
      }
      writeProblem(
        response,
        buildProblem({
          code:
            type === 'entity.too.large'
              ? 'PAYLOAD_TOO_LARGE'
              : 'MALFORMED_REQUEST',
          requestId: readRequestIdFrom(request),
        }),
      );
    },
  );
  if (process.env.TRUST_PROXY === 'true') {
    enableTrustProxy(app);
  }
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API de Emissão de Certificados')
    .setDescription('API independente para emitir e verificar certificados.')
    .setVersion('1.0')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, openApiDocument);

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000);
}

function enableTrustProxy(app: INestApplication): void {
  const instance: unknown = app.getHttpAdapter().getInstance();
  if (!isTrustProxyApp(instance)) {
    throw new Error('HTTP adapter does not support trust proxy');
  }
  instance.set('trust proxy', 1);
}

function isTrustProxyApp(
  value: unknown,
): value is { set(setting: string, value: number): void } {
  if (typeof value !== 'object' || value === null || !('set' in value)) {
    return false;
  }
  const candidate = value as { set?: unknown };
  return typeof candidate.set === 'function';
}

void bootstrap();
