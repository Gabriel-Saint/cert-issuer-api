import { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';

export const CERTIFICATE_RENDERER = Symbol('CERTIFICATE_RENDERER');

export interface CertificateRenderInput {
  snapshot: CertificateSnapshot;
  registrationNumber: string;
  verificationCode: string;
  verificationUrl: string;
  markAsTest: boolean;
}

export interface CertificateRendererPort {
  render(input: CertificateRenderInput): Promise<Buffer>;
}
