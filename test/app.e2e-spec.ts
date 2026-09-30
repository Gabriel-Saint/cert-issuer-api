import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/infrastructure/persistence/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest
          .fn()
          .mockRejectedValue(new Error('database unavailable')),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });

  it('/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/v1/health/ready (GET) returns 503 when PostgreSQL is unavailable', () => {
    return request(app.getHttpServer())
      .get('/v1/health/ready')
      .expect(503)
      .expect((response) => {
        expect(readProblemCode(response.body)).toBe('DEPENDENCY_UNAVAILABLE');
        expect(response.headers['content-type']).toContain(
          'application/problem+json',
        );
      });
  });

  afterEach(async () => {
    await app.close();
  });
});

function readProblemCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return undefined;
  }
  const code = body.code;
  return typeof code === 'string' ? code : undefined;
}
