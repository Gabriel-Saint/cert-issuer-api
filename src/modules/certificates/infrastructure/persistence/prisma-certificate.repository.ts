import { Injectable } from '@nestjs/common';
import { CertificateStatus, Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../../infrastructure/persistence/prisma.service';
import { CertificateConflictError } from '../../application/errors/certificate-conflict.error';
import { InvalidTransitionError } from '../../application/errors/invalid-transition.error';
import { StateConflictError } from '../../application/errors/state-conflict.error';
import { CertificateNotFoundError } from '../../application/errors/certificate-not-found.error';
import {
  CertificateRepositoryPort,
  CertificateReservation,
  ReissueReservation,
  ReserveCertificateInput,
  ReserveReissueInput,
  RevokeCertificateInput,
  RevokeCertificateResult,
} from '../../application/ports/certificate-repository.port';
import { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';

@Injectable()
export class PrismaCertificateRepository implements CertificateRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(
    input: ReserveCertificateInput,
  ): Promise<CertificateReservation> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const previousRequest = await transaction.idempotencyRecord.findUnique({
          where: {
            clientDbId_key: {
              clientDbId: input.clientDbId,
              key: input.idempotencyKey,
            },
          },
        });

        if (previousRequest) {
          if (previousRequest.requestHash !== input.requestHash) {
            throw new CertificateConflictError(
              'Idempotency-Key was already used with a different request body',
              'IDEMPOTENCY_CONFLICT',
            );
          }
          if (previousRequest.resourceId) {
            const existing = await transaction.certificate.findUniqueOrThrow({
              where: { id: previousRequest.resourceId },
            });
            return this.toReservation(existing, false);
          }
          return {
            certificateId: '',
            verificationCode: '',
            registrationNumber: '',
            objectKey: null,
            pdfSha256: null,
            pdfSizeBytes: null,
            status: 'PROCESSING',
            created: false,
          };
        }

        const series = await transaction.certificateSeries.upsert({
          where: {
            integrationId_identityKey: {
              integrationId: input.integrationId,
              identityKey: input.identityKey,
            },
          },
          create: {
            integrationId: input.integrationId,
            identityKey: input.identityKey,
            externalStudentId: input.externalStudentId,
            courseId: input.courseId,
            deliveryMode:
              input.deliveryMode === 'online' ? 'ONLINE' : 'IN_PERSON',
            classId: input.classId,
          },
          update: {},
        });

        const issued = await transaction.certificate.findFirst({
          where: { seriesId: series.id, status: CertificateStatus.ISSUED },
          orderBy: { revision: 'desc' },
        });

        if (issued) {
          if (!isDeepStrictEqual(issued.snapshot, input.snapshot)) {
            throw new CertificateConflictError(
              'Certificate identity already exists with different certificate data',
            );
          }
          await transaction.idempotencyRecord.create({
            data: {
              clientDbId: input.clientDbId,
              key: input.idempotencyKey,
              requestHash: input.requestHash,
              state: 'ISSUED',
              resourceId: issued.id,
            },
          });
          return this.toReservation(issued, false);
        }

        const processing = await transaction.certificate.findFirst({
          where: { seriesId: series.id, status: CertificateStatus.PROCESSING },
          orderBy: { revision: 'desc' },
        });
        if (processing) {
          if (!isDeepStrictEqual(processing.snapshot, input.snapshot)) {
            throw new CertificateConflictError(
              'Certificate identity is already being issued with different data',
            );
          }
          await transaction.idempotencyRecord.create({
            data: {
              clientDbId: input.clientDbId,
              key: input.idempotencyKey,
              requestHash: input.requestHash,
              state: 'PROCESSING',
              resourceId: processing.id,
            },
          });
          return this.toReservation(processing, false);
        }

        const counter = await transaction.registrationCounter.upsert({
          where: {
            institutionId_year: {
              institutionId: input.institutionId,
              year: input.registrationYear,
            },
          },
          create: {
            institutionId: input.institutionId,
            year: input.registrationYear,
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
        });
        const registrationNumber = `${input.registrationYear}-${counter.lastValue
          .toString()
          .padStart(6, '0')}`;
        const verificationCode = randomBytes(16).toString('base64url');
        const revision = series.currentRevision + 1;
        const certificate = await transaction.certificate.create({
          data: {
            integrationId: input.integrationId,
            seriesId: series.id,
            revision,
            certificateType: input.certificateType,
            verificationCode,
            registrationYear: input.registrationYear,
            registrationSequence: counter.lastValue,
            registrationNumber,
            snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
            templateVersion: input.templateVersion,
          },
        });

        await transaction.certificateSeries.update({
          where: { id: series.id },
          data: { currentRevision: revision },
        });
        await transaction.idempotencyRecord.create({
          data: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
            requestHash: input.requestHash,
            state: 'PROCESSING',
            resourceId: certificate.id,
          },
        });

        return this.toReservation(certificate, true);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const previousRequest = await this.prisma.idempotencyRecord.findUnique({
          where: {
            clientDbId_key: {
              clientDbId: input.clientDbId,
              key: input.idempotencyKey,
            },
          },
        });
        if (previousRequest) {
          if (previousRequest.requestHash !== input.requestHash) {
            throw new CertificateConflictError(
              'Idempotency-Key was already used with a different request body',
              'IDEMPOTENCY_CONFLICT',
            );
          }
          if (previousRequest.resourceId) {
            const existing = await this.prisma.certificate.findUniqueOrThrow({
              where: { id: previousRequest.resourceId },
            });
            return this.toReservation(existing, false);
          }
        }
        throw new CertificateConflictError(
          'A certificate with this identity is already processing',
        );
      }
      throw error;
    }
  }

  async markIssued(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    objectKey: string;
    pdfSha256: string;
    pdfSizeBytes: number;
    requestId: string;
    clientId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const certificate = await transaction.certificate.update({
        where: { id: input.certificateId },
        data: {
          status: CertificateStatus.ISSUED,
          pdfObjectKey: input.objectKey,
          pdfSha256: input.pdfSha256,
          pdfSizeBytes: BigInt(input.pdfSizeBytes),
          completedAt: new Date(),
        },
      });
      await transaction.idempotencyRecord.update({
        where: {
          clientDbId_key: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
          },
        },
        data: { state: 'ISSUED' },
      });
      await transaction.auditEvent.create({
        data: {
          integrationId: certificate.integrationId,
          clientId: input.clientId,
          eventType: 'certificate.issued',
          outcome: 'success',
          requestId: input.requestId,
          reference: certificate.id,
          details: { registrationNumber: certificate.registrationNumber },
        },
      });
    });
  }

  async markFailed(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    failureCode: string;
    requestId: string;
    clientId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const certificate = await transaction.certificate.update({
        where: { id: input.certificateId },
        data: {
          status: CertificateStatus.FAILED,
          failureCode: input.failureCode,
        },
      });
      await transaction.idempotencyRecord.update({
        where: {
          clientDbId_key: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
          },
        },
        data: { state: 'FAILED' },
      });
      await transaction.auditEvent.create({
        data: {
          integrationId: certificate.integrationId,
          clientId: input.clientId,
          eventType: 'certificate.issue_failed',
          outcome: 'failure',
          requestId: input.requestId,
          reference: certificate.id,
          details: { failureCode: input.failureCode },
        },
      });
    });
  }

  async reserveReissue(
    input: ReserveReissueInput,
  ): Promise<ReissueReservation> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const replay = await this.readIdempotentCertificate(
          transaction,
          input.clientDbId,
          input.idempotencyKey,
          input.requestHash,
        );
        if (replay) {
          return replay;
        }

        const current = await transaction.certificate.findFirst({
          where: {
            id: input.certificateId,
            integrationId: input.integrationId,
          },
          include: { series: true },
        });
        if (!current) {
          throw new CertificateNotFoundError();
        }
        if (current.status !== CertificateStatus.ISSUED) {
          throw new InvalidTransitionError();
        }
        const processing = await transaction.certificate.findFirst({
          where: {
            seriesId: current.seriesId,
            status: CertificateStatus.PROCESSING,
          },
        });
        if (processing) {
          throw new StateConflictError();
        }

        const counter = await transaction.registrationCounter.upsert({
          where: {
            institutionId_year: {
              institutionId: input.institutionId,
              year: input.registrationYear,
            },
          },
          create: {
            institutionId: input.institutionId,
            year: input.registrationYear,
            lastValue: 1,
          },
          update: { lastValue: { increment: 1 } },
        });
        const registrationNumber = `${input.registrationYear}-${counter.lastValue
          .toString()
          .padStart(6, '0')}`;
        const revision = current.series.currentRevision + 1;
        const previousSnapshot =
          current.snapshot as unknown as CertificateSnapshot;
        const snapshot: CertificateSnapshot = {
          ...input.snapshot,
          deliveryMode: previousSnapshot.deliveryMode,
          classId: previousSnapshot.classId,
        };
        const certificate = await transaction.certificate.create({
          data: {
            integrationId: input.integrationId,
            seriesId: current.seriesId,
            revision,
            certificateType: current.certificateType,
            verificationCode: randomBytes(16).toString('base64url'),
            registrationYear: input.registrationYear,
            registrationSequence: counter.lastValue,
            registrationNumber,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            templateVersion: input.templateVersion,
            supersedesId: current.id,
          },
        });
        await transaction.certificateSeries.update({
          where: { id: current.seriesId },
          data: { currentRevision: revision },
        });
        await transaction.idempotencyRecord.create({
          data: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
            requestHash: input.requestHash,
            state: 'PROCESSING',
            resourceId: certificate.id,
          },
        });
        return this.toReissueReservation(certificate, current.id, true);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.readIdempotentCertificate(
          this.prisma,
          input.clientDbId,
          input.idempotencyKey,
          input.requestHash,
        );
        if (replay) {
          return replay;
        }
        throw new StateConflictError();
      }
      throw error;
    }
  }

  async completeReissue(input: {
    certificateId: string;
    previousCertificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    objectKey: string;
    pdfSha256: string;
    pdfSizeBytes: number;
    requestId: string;
    clientId: string;
    actorId: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.certificate.findUniqueOrThrow({
        where: { id: input.certificateId },
      });
      const previous = await transaction.certificate.findUniqueOrThrow({
        where: { id: input.previousCertificateId },
      });
      if (
        current.status !== CertificateStatus.PROCESSING ||
        current.supersedesId !== previous.id ||
        previous.status !== CertificateStatus.ISSUED
      ) {
        throw new StateConflictError();
      }
      await transaction.certificate.update({
        where: { id: previous.id },
        data: { status: CertificateStatus.SUPERSEDED },
      });
      await transaction.certificate.update({
        where: { id: current.id },
        data: {
          status: CertificateStatus.ISSUED,
          pdfObjectKey: input.objectKey,
          pdfSha256: input.pdfSha256,
          pdfSizeBytes: BigInt(input.pdfSizeBytes),
          completedAt: new Date(),
        },
      });
      await transaction.idempotencyRecord.update({
        where: {
          clientDbId_key: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
          },
        },
        data: { state: 'ISSUED' },
      });
      await transaction.auditEvent.create({
        data: {
          integrationId: current.integrationId,
          clientId: input.clientId,
          actorId: input.actorId,
          eventType: 'certificate.reissued',
          outcome: 'success',
          requestId: input.requestId,
          reference: current.id,
          details: {
            previousCertificateId: previous.id,
            reason: input.reason,
          },
        },
      });
    });
  }

  async failReissue(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    failureCode: string;
    requestId: string;
    clientId: string;
    actorId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.certificate.findUnique({
        where: { id: input.certificateId },
      });
      if (!current || current.status !== CertificateStatus.PROCESSING) {
        return;
      }
      await transaction.certificate.update({
        where: { id: current.id },
        data: {
          status: CertificateStatus.FAILED,
          failureCode: input.failureCode,
        },
      });
      await transaction.idempotencyRecord.update({
        where: {
          clientDbId_key: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
          },
        },
        data: { state: 'FAILED' },
      });
      await transaction.auditEvent.create({
        data: {
          integrationId: current.integrationId,
          clientId: input.clientId,
          actorId: input.actorId,
          eventType: 'certificate.reissue_failed',
          outcome: 'failure',
          requestId: input.requestId,
          reference: current.id,
          details: { failureCode: input.failureCode },
        },
      });
    });
  }

  async revoke(
    input: RevokeCertificateInput,
  ): Promise<RevokeCertificateResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const previousRequest = await transaction.idempotencyRecord.findUnique({
          where: {
            clientDbId_key: {
              clientDbId: input.clientDbId,
              key: input.idempotencyKey,
            },
          },
        });
        if (previousRequest) {
          if (previousRequest.requestHash !== input.requestHash) {
            throw new CertificateConflictError(
              'Idempotency-Key was already used with a different request body',
              'IDEMPOTENCY_CONFLICT',
            );
          }
          if (!previousRequest.resourceId) {
            throw new StateConflictError();
          }
          const existing = await transaction.certificate.findUniqueOrThrow({
            where: { id: previousRequest.resourceId },
          });
          return {
            certificateId: existing.id,
            status: 'REVOKED',
            verificationCode: existing.verificationCode,
            registrationNumber: existing.registrationNumber,
            reused: true,
          };
        }

        const certificate = await transaction.certificate.findFirst({
          where: {
            id: input.certificateId,
            integrationId: input.integrationId,
          },
        });
        if (!certificate) {
          throw new CertificateNotFoundError();
        }
        if (certificate.status !== CertificateStatus.ISSUED) {
          throw new InvalidTransitionError();
        }
        const processing = await transaction.certificate.findFirst({
          where: {
            seriesId: certificate.seriesId,
            status: CertificateStatus.PROCESSING,
          },
        });
        if (processing) {
          throw new StateConflictError();
        }

        const revoked = await transaction.certificate.update({
          where: { id: certificate.id },
          data: {
            status: CertificateStatus.REVOKED,
            revokedAt: new Date(),
            revocationReason: input.reason,
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            clientDbId: input.clientDbId,
            key: input.idempotencyKey,
            requestHash: input.requestHash,
            state: 'REVOKED',
            resourceId: revoked.id,
          },
        });
        await transaction.auditEvent.create({
          data: {
            integrationId: revoked.integrationId,
            clientId: input.clientId,
            actorId: input.actorId,
            eventType: 'certificate.revoked',
            outcome: 'success',
            requestId: input.requestId,
            reference: revoked.id,
            details: { reason: input.reason },
          },
        });
        return {
          certificateId: revoked.id,
          status: 'REVOKED',
          verificationCode: revoked.verificationCode,
          registrationNumber: revoked.registrationNumber,
          reused: false,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new StateConflictError();
      }
      throw error;
    }
  }
  private async readIdempotentCertificate(
    client: Prisma.TransactionClient | PrismaService,
    clientDbId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<ReissueReservation | null> {
    const previousRequest = await client.idempotencyRecord.findUnique({
      where: {
        clientDbId_key: { clientDbId, key: idempotencyKey },
      },
    });
    if (!previousRequest) {
      return null;
    }
    if (previousRequest.requestHash !== requestHash) {
      throw new CertificateConflictError(
        'Idempotency-Key was already used with a different request body',
        'IDEMPOTENCY_CONFLICT',
      );
    }
    if (!previousRequest.resourceId) {
      throw new StateConflictError();
    }
    const existing = await client.certificate.findUniqueOrThrow({
      where: { id: previousRequest.resourceId },
    });
    return this.toReissueReservation(existing, existing.supersedesId, false);
  }

  private toReissueReservation(
    certificate: {
      id: string;
      verificationCode: string;
      registrationNumber: string;
      pdfObjectKey: string | null;
      pdfSha256: string | null;
      pdfSizeBytes: bigint | null;
      status: CertificateStatus;
      supersedesId: string | null;
      snapshot: Prisma.JsonValue;
    },
    previousCertificateId: string | null,
    created: boolean,
  ): ReissueReservation {
    return {
      ...this.toReservation(certificate, created),
      previousCertificateId,
      snapshot: certificate.snapshot as unknown as CertificateSnapshot,
    };
  }

  private toReservation(
    certificate: {
      id: string;
      verificationCode: string;
      registrationNumber: string;
      pdfObjectKey: string | null;
      pdfSha256: string | null;
      pdfSizeBytes: bigint | null;
      status: CertificateStatus;
    },
    created: boolean,
  ): CertificateReservation {
    return {
      certificateId: certificate.id,
      verificationCode: certificate.verificationCode,
      registrationNumber: certificate.registrationNumber,
      objectKey: certificate.pdfObjectKey,
      pdfSha256: certificate.pdfSha256,
      pdfSizeBytes: certificate.pdfSizeBytes,
      status: certificate.status,
      created,
    };
  }
}
