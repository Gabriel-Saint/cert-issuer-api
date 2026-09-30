import { CertificateStatus } from '@prisma/client';
import type { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';
import type { DeliveryMode } from '../../domain/value-objects/certificate-identity';

export const CERTIFICATE_QUERY_REPOSITORY = Symbol(
  'CERTIFICATE_QUERY_REPOSITORY',
);

export interface PublicCertificateRecord {
  verificationCode: string;
  registrationNumber: string;
  status: CertificateStatus;
  snapshot: unknown;
}

export type PrivateCertificateStatus =
  'PROCESSING' | 'ISSUED' | 'FAILED' | 'REVOKED' | 'SUPERSEDED';

export interface PrivateCertificateRecord {
  certificateId: string;
  status: PrivateCertificateStatus;
  verificationCode: string;
  registrationNumber: string;
  identityKey: string;
  externalStudentId: string;
  courseId: string;
  deliveryMode: DeliveryMode;
  classId: string | null;
  revision: number;
  supersedesId: string | null;
  revocationReason: string | null;
  revokedAt: string | null;
  pdfSha256: string | null;
  pdfObjectKey: string | null;
  snapshot: CertificateSnapshot;
  failureCode: string | null;
}

export interface CertificateQueryRepositoryPort {
  findPublicByCode(code: string): Promise<PublicCertificateRecord | null>;
  findPrivateById(
    integrationId: string,
    certificateId: string,
  ): Promise<PrivateCertificateRecord | null>;
  findCurrentByIdentityKey(
    integrationId: string,
    identityKey: string,
  ): Promise<PrivateCertificateRecord | null>;
  findComparableHash(code: string): Promise<string | null>;
}
