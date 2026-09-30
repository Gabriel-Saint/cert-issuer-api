import { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';
import { DeliveryMode } from '../../domain/value-objects/certificate-identity';

export const CERTIFICATE_REPOSITORY = Symbol('CERTIFICATE_REPOSITORY');

export interface ReserveCertificateInput {
  integrationId: string;
  clientDbId: string;
  institutionId: string;
  identityKey: string;
  externalStudentId: string;
  courseId: string;
  deliveryMode: DeliveryMode;
  classId: string | null;
  idempotencyKey: string;
  requestHash: string;
  certificateType: string;
  templateVersion: string;
  snapshot: CertificateSnapshot;
  registrationYear: number;
}

export interface CertificateReservation {
  certificateId: string;
  verificationCode: string;
  registrationNumber: string;
  objectKey: string | null;
  pdfSha256: string | null;
  pdfSizeBytes: bigint | null;
  status: 'PROCESSING' | 'ISSUED' | 'FAILED' | 'REVOKED' | 'SUPERSEDED';
  created: boolean;
}

export interface AuditContext {
  requestId: string;
  clientId: string;
  actorId?: string | null;
}

export interface ReserveReissueInput {
  integrationId: string;
  clientDbId: string;
  institutionId: string;
  certificateId: string;
  idempotencyKey: string;
  requestHash: string;
  templateVersion: string;
  snapshot: CertificateSnapshot;
  registrationYear: number;
}

export interface ReissueReservation extends CertificateReservation {
  previousCertificateId: string | null;
  snapshot: CertificateSnapshot;
}

export interface RevokeCertificateInput {
  integrationId: string;
  clientDbId: string;
  certificateId: string;
  idempotencyKey: string;
  requestHash: string;
  actorId: string;
  reason: string;
  requestId: string;
  clientId: string;
}

export interface RevokeCertificateResult {
  certificateId: string;
  status: 'REVOKED';
  verificationCode: string;
  registrationNumber: string;
  reused: boolean;
}

export interface CertificateRepositoryPort {
  reserve(input: ReserveCertificateInput): Promise<CertificateReservation>;
  markIssued(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    objectKey: string;
    pdfSha256: string;
    pdfSizeBytes: number;
    requestId: string;
    clientId: string;
  }): Promise<void>;
  markFailed(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    failureCode: string;
    requestId: string;
    clientId: string;
  }): Promise<void>;
  reserveReissue(input: ReserveReissueInput): Promise<ReissueReservation>;
  completeReissue(input: {
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
  }): Promise<void>;
  failReissue(input: {
    certificateId: string;
    clientDbId: string;
    idempotencyKey: string;
    failureCode: string;
    requestId: string;
    clientId: string;
    actorId: string;
  }): Promise<void>;
  revoke(input: RevokeCertificateInput): Promise<RevokeCertificateResult>;
}
