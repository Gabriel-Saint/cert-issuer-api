import { Inject, Injectable } from '@nestjs/common';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { CERTIFICATE_QUERY_REPOSITORY } from '../ports/certificate-query-repository.port';
import type {
  CertificateQueryRepositoryPort,
  PrivateCertificateRecord,
} from '../ports/certificate-query-repository.port';

@Injectable()
export class GetCertificateByReferenceUseCase {
  constructor(
    @Inject(CERTIFICATE_QUERY_REPOSITORY)
    private readonly certificates: CertificateQueryRepositoryPort,
  ) {}

  async execute(
    integrationId: string,
    identityKey: string,
  ): Promise<PrivateCertificateRecord> {
    if (!/^[0-9a-f]{64}$/.test(identityKey)) {
      throw new CertificateNotFoundError();
    }
    const certificate = await this.certificates.findCurrentByIdentityKey(
      integrationId,
      identityKey,
    );
    if (!certificate) {
      throw new CertificateNotFoundError();
    }
    return certificate;
  }
}
