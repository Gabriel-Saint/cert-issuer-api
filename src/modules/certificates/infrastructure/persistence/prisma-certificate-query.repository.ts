import { Injectable } from '@nestjs/common';
import {
  Certificate,
  CertificateSeries,
  CertificateStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/persistence/prisma.service';
import type { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';
import {
  CertificateQueryRepositoryPort,
  PrivateCertificateRecord,
  PublicCertificateRecord,
} from '../../application/ports/certificate-query-repository.port';

const COMPARABLE_STATUSES: CertificateStatus[] = [
  CertificateStatus.ISSUED,
  CertificateStatus.REVOKED,
  CertificateStatus.SUPERSEDED,
];

@Injectable()
export class PrismaCertificateQueryRepository implements CertificateQueryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findPublicByCode(code: string): Promise<PublicCertificateRecord | null> {
    if (code.length === 0 || code.length > 64) {
      return Promise.resolve(null);
    }
    return this.prisma.certificate.findUnique({
      where: { verificationCode: code },
      select: {
        verificationCode: true,
        registrationNumber: true,
        status: true,
        snapshot: true,
      },
    });
  }

  async findPrivateById(
    integrationId: string,
    certificateId: string,
  ): Promise<PrivateCertificateRecord | null> {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id: certificateId, integrationId },
      include: { series: true },
    });
    return certificate ? this.toPrivate(certificate) : null;
  }

  async findCurrentByIdentityKey(
    integrationId: string,
    identityKey: string,
  ): Promise<PrivateCertificateRecord | null> {
    const series = await this.prisma.certificateSeries.findUnique({
      where: {
        integrationId_identityKey: { integrationId, identityKey },
      },
      include: { certificates: { orderBy: { revision: 'desc' } } },
    });
    if (!series || series.certificates.length === 0) {
      return null;
    }
    const current =
      series.certificates.find(
        (certificate) => certificate.status === CertificateStatus.ISSUED,
      ) ??
      series.certificates.find(
        (certificate) => certificate.status === CertificateStatus.PROCESSING,
      ) ??
      series.certificates[0];
    return this.toPrivate({ ...current, series });
  }

  async findComparableHash(code: string): Promise<string | null> {
    if (code.length === 0 || code.length > 64) {
      return null;
    }
    const certificate = await this.prisma.certificate.findUnique({
      where: { verificationCode: code },
      select: { status: true, pdfSha256: true },
    });
    if (
      !certificate?.pdfSha256 ||
      !COMPARABLE_STATUSES.includes(certificate.status)
    ) {
      return null;
    }
    return certificate.pdfSha256.trim().toLowerCase();
  }

  private toPrivate(
    certificate: Certificate & { series: CertificateSeries },
  ): PrivateCertificateRecord {
    return {
      certificateId: certificate.id,
      status: certificate.status,
      verificationCode: certificate.verificationCode,
      registrationNumber: certificate.registrationNumber,
      identityKey: certificate.series.identityKey,
      externalStudentId: certificate.series.externalStudentId,
      courseId: certificate.series.courseId,
      deliveryMode:
        certificate.series.deliveryMode === 'ONLINE' ? 'online' : 'in_person',
      classId: certificate.series.classId,
      revision: certificate.revision,
      supersedesId: certificate.supersedesId,
      revocationReason: certificate.revocationReason,
      revokedAt: certificate.revokedAt?.toISOString() ?? null,
      pdfSha256: certificate.pdfSha256?.trim() ?? null,
      pdfObjectKey: certificate.pdfObjectKey,
      snapshot: certificate.snapshot as unknown as CertificateSnapshot,
      failureCode: certificate.failureCode,
    };
  }
}
