import type { PrivateCertificateRecord } from '../../application/ports/certificate-query-repository.port';

export interface CertificateView {
  certificateId: string;
  status: PrivateCertificateRecord['status'];
  verificationCode: string;
  registrationNumber: string;
  identityKey: string;
  externalStudentId: string;
  courseId: string;
  deliveryMode: PrivateCertificateRecord['deliveryMode'];
  classId: string | null;
  revision: number;
  supersedesId: string | null;
  revocationReason: string | null;
  revokedAt: string | null;
  pdfSha256: string | null;
  failureCode: string | null;
  snapshot: PrivateCertificateRecord['snapshot'];
}

export function toCertificateView(
  certificate: PrivateCertificateRecord,
): CertificateView {
  return {
    certificateId: certificate.certificateId,
    status: certificate.status,
    verificationCode: certificate.verificationCode,
    registrationNumber: certificate.registrationNumber,
    identityKey: certificate.identityKey,
    externalStudentId: certificate.externalStudentId,
    courseId: certificate.courseId,
    deliveryMode: certificate.deliveryMode,
    classId: certificate.classId,
    revision: certificate.revision,
    supersedesId: certificate.supersedesId,
    revocationReason: certificate.revocationReason,
    revokedAt: certificate.revokedAt,
    pdfSha256: certificate.pdfSha256,
    failureCode: certificate.failureCode,
    snapshot: certificate.snapshot,
  };
}
