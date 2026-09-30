import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { PrismaService } from './infrastructure/persistence/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns an ok status', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });
  });

  describe('readiness', () => {
    it('returns ready when PostgreSQL query succeeds', async () => {
      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ready',
      });
    });
  });
});
