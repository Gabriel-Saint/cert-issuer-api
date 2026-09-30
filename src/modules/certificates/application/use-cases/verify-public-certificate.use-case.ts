import { CertificateStatus } from '@prisma/client';
import { Inject, Injectable } from '@nestjs/common';
import type { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { CERTIFICATE_QUERY_REPOSITORY } from '../ports/certificate-query-repository.port';
import type { CertificateQueryRepositoryPort } from '../ports/certificate-query-repository.port';

export interface PublicCertificateVerification {
  status: 'valid' | 'revoked' | 'replaced';
  studentName: string;
  courseTitle: string;
  institutionName: string;
  completionDate: string;
}

@Injectable()
export class VerifyPublicCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_QUERY_REPOSITORY)
    private readonly certificates: CertificateQueryRepositoryPort,
  ) {}

  async execute(code: string): Promise<PublicCertificateVerification> {
    const certificate = await this.certificates.findPublicByCode(code);
    if (
      !certificate ||
      certificate.status === CertificateStatus.PROCESSING ||
      certificate.status === CertificateStatus.FAILED
    ) {
      throw new CertificateNotFoundError();
    }

    const snapshot = certificate.snapshot as CertificateSnapshot;
    const status =
      certificate.status === CertificateStatus.ISSUED
        ? 'valid'
        : certificate.status === CertificateStatus.REVOKED
          ? 'revoked'
          : 'replaced';

    return {
      status,
      studentName: snapshot.studentName,
      courseTitle: snapshot.courseTitle,
      institutionName: snapshot.institutionName,
      completionDate: snapshot.completionDate,
    };
  }
}
