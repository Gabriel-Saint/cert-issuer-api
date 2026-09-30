export const CERTIFICATE_ISSUANCE_CONFIG = Symbol(
  'CERTIFICATE_ISSUANCE_CONFIG',
);

export interface CertificateIssuanceConfig {
  environment: string;
  institutionName: string;
  templateVersion: string;
  verificationBaseUrl: string;
}
