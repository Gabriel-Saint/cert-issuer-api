import { Inject, Injectable } from '@nestjs/common';
import { isCertificateId } from '../../domain/certificate-id';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { CERTIFICATE_REPOSITORY } from '../ports/certificate-repository.port';
import type {
  CertificateRepositoryPort,
  RevokeCertificateResult,
} from '../ports/certificate-repository.port';

export interface RevokeCertificateCommand {
  integrationId: string;
  clientDbId: string;
  clientId: string;
  certificateId: string;
  idempotencyKey: string;
  requestHash: string;
  actorId: string;
  reason: string;
  requestId: string;
}

@Injectable()
export class RevokeCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_REPOSITORY)
    private readonly certificates: CertificateRepositoryPort,
  ) {}

  execute(command: RevokeCertificateCommand): Promise<RevokeCertificateResult> {
    if (!isCertificateId(command.certificateId)) {
      throw new CertificateNotFoundError();
    }
    return this.certificates.revoke(command);
  }
}
