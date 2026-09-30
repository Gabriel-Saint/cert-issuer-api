import { Inject, Injectable } from '@nestjs/common';
import { isCertificateId } from '../../domain/certificate-id';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { CERTIFICATE_QUERY_REPOSITORY } from '../ports/certificate-query-repository.port';
import type {
  CertificateQueryRepositoryPort,
  PrivateCertificateRecord,
} from '../ports/certificate-query-repository.port';

@Injectable()
export class GetCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_QUERY_REPOSITORY)
    private readonly certificates: CertificateQueryRepositoryPort,
  ) {}

  async execute(
    integrationId: string,
    certificateId: string,
  ): Promise<PrivateCertificateRecord> {
    if (!isCertificateId(certificateId)) {
      throw new CertificateNotFoundError();
    }
    const certificate = await this.certificates.findPrivateById(
      integrationId,
      certificateId,
    );
    if (!certificate) {
      throw new CertificateNotFoundError();
    }
    return certificate;
  }
}
