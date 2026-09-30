import { Inject, Injectable } from '@nestjs/common';
import { isCertificateId } from '../../domain/certificate-id';
import { DOWNLOAD_URL_TTL_SECONDS } from '../../domain/certificate.constants';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { DependencyUnavailableError } from '../errors/dependency-unavailable.error';
import { StateConflictError } from '../errors/state-conflict.error';
import { AUDIT_WRITER } from '../ports/audit-writer.port';
import type { AuditWriterPort } from '../ports/audit-writer.port';
import { CERTIFICATE_QUERY_REPOSITORY } from '../ports/certificate-query-repository.port';
import type { CertificateQueryRepositoryPort } from '../ports/certificate-query-repository.port';
import { CERTIFICATE_STORAGE } from '../ports/certificate-storage.port';
import type { CertificateStoragePort } from '../ports/certificate-storage.port';

export interface DownloadCertificateCommand {
  integrationId: string;
  certificateId: string;
  clientId: string;
  requestId: string;
}

export interface DownloadCertificateResult {
  downloadUrl: string;
  expiresInSeconds: number;
}

const DOWNLOADABLE_STATUSES = new Set(['ISSUED', 'REVOKED', 'SUPERSEDED']);

@Injectable()
export class DownloadCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_QUERY_REPOSITORY)
    private readonly certificates: CertificateQueryRepositoryPort,
    @Inject(CERTIFICATE_STORAGE)
    private readonly storage: CertificateStoragePort,
    @Inject(AUDIT_WRITER)
    private readonly audit: AuditWriterPort,
  ) {}

  async execute(
    command: DownloadCertificateCommand,
  ): Promise<DownloadCertificateResult> {
    if (!isCertificateId(command.certificateId)) {
      throw new CertificateNotFoundError();
    }
    const certificate = await this.certificates.findPrivateById(
      command.integrationId,
      command.certificateId,
    );
    if (!certificate) {
      throw new CertificateNotFoundError();
    }
    if (
      !DOWNLOADABLE_STATUSES.has(certificate.status) ||
      !certificate.pdfObjectKey
    ) {
      throw new StateConflictError();
    }

    let downloadUrl: string;
    try {
      downloadUrl = await this.storage.createDownloadUrl(
        certificate.pdfObjectKey,
        DOWNLOAD_URL_TTL_SECONDS,
      );
    } catch {
      throw new DependencyUnavailableError();
    }

    await this.audit.write({
      integrationId: command.integrationId,
      clientId: command.clientId,
      eventType: 'certificate.downloaded',
      outcome: 'success',
      requestId: command.requestId,
      reference: certificate.certificateId,
    });

    return { downloadUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }
}
