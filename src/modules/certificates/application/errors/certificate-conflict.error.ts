export class CertificateConflictError extends Error {
  readonly code: 'CERTIFICATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT';

  constructor(
    message: string,
    code:
      'CERTIFICATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT' = 'CERTIFICATE_CONFLICT',
  ) {
    super(message);
    this.name = 'CertificateConflictError';
    this.code = code;
  }
}
