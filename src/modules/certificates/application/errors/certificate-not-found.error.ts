export class CertificateNotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor() {
    super('Certificate not found');
    this.name = 'CertificateNotFoundError';
  }
}
