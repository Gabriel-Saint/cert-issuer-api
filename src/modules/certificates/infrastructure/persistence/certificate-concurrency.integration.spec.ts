import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaRateLimitStore } from '../../../rate-limit/infrastructure/prisma-rate-limit.store';
import { PrismaService } from '../../../../infrastructure/persistence/prisma.service';

config();

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' && process.env.DATABASE_URL;
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('PostgreSQL concurrency constraints', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows only one issued certificate per series', async () => {
    const namespace = `concurrency-${randomUUID()}`;
    const integration = await prisma.integration.create({
      data: {
        namespace,
        displayName: 'Concurrency',
        institutionId: 'concurrency-institution',
      },
    });
    const series = await prisma.certificateSeries.create({
      data: {
        integrationId: integration.id,
        identityKey: 'a'.repeat(64),
        externalStudentId: 'student',
        courseId: 'course',
        deliveryMode: 'ONLINE',
      },
    });

    try {
      const results = await Promise.allSettled([
        createIssued(integration.id, series.id, 1),
        createIssued(integration.id, series.id, 2),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    } finally {
      await prisma.certificate.deleteMany({ where: { seriesId: series.id } });
      await prisma.certificateSeries.delete({ where: { id: series.id } });
      await prisma.integration.delete({ where: { id: integration.id } });
    }
  });

  it('rejects online series that include a class id', async () => {
    const integration = await prisma.integration.create({
      data: {
        namespace: `check-${randomUUID()}`,
        displayName: 'Check',
        institutionId: 'concurrency-institution',
      },
    });
    try {
      await expect(
        prisma.certificateSeries.create({
          data: {
            integrationId: integration.id,
            identityKey: 'b'.repeat(64),
            externalStudentId: 'student',
            courseId: 'course',
            deliveryMode: 'ONLINE',
            classId: 'class-1',
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.integration.delete({ where: { id: integration.id } });
    }
  });

  it('does not let parallel consumers exceed the token burst', async () => {
    const store = new PrismaRateLimitStore(prisma as unknown as PrismaService);
    const key = `test:${randomUUID()}`;
    try {
      const decisions = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.consume([{ key, limitPerMinute: 60, burst: 5 }]),
        ),
      );
      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    } finally {
      await prisma.rateLimitBucket.deleteMany({ where: { bucketKey: key } });
    }
  });

  function createIssued(
    integrationId: string,
    seriesId: string,
    revision: number,
  ) {
    return prisma.certificate.create({
      data: {
        integrationId,
        seriesId,
        revision,
        status: 'ISSUED',
        certificateType: 'standard',
        verificationCode: randomUUID(),
        registrationYear: 2026,
        registrationSequence: revision,
        registrationNumber: `${randomUUID()}-n`,
        snapshot: { studentName: 'Aluno de Teste' },
        templateVersion: 'test-v1',
      },
    });
  }
});
