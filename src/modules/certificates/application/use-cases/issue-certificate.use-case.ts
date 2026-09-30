import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CertificateIdentity } from '../../domain/value-objects/certificate-identity';
import { CERTIFICATE_ISSUANCE_CONFIG } from '../ports/certificate-issuance-config.port';
import type { CertificateIssuanceConfig } from '../ports/certificate-issuance-config.port';
import { CERTIFICATE_RENDERER } from '../ports/certificate-renderer.port';
import type { CertificateRendererPort } from '../ports/certificate-renderer.port';
import { CERTIFICATE_REPOSITORY } from '../ports/certificate-repository.port';
import type { CertificateRepositoryPort } from '../ports/certificate-repository.port';
import { CERTIFICATE_STORAGE } from '../ports/certificate-storage.port';
import type { CertificateStoragePort } from '../ports/certificate-storage.port';
import { DOWNLOAD_URL_TTL_SECONDS } from '../../domain/certificate.constants';
import { CertificateConflictError } from '../errors/certificate-conflict.error';
import { TestDataNotAllowedError } from '../errors/test-data-not-allowed.error';
import { IssueCertificateDto } from '../../presentation/dto/issue-certificate.dto';

export interface IssueCertificateCommand {
  integrationId: string;
  institutionId: string;
  clientDbId: string;
  clientId: string;
  requestId: string;
  idempotencyKey: string;
  requestHash: string;
  input: IssueCertificateDto;
}

export interface IssueCertificateResult {
  certificateId: string;
  status: 'PROCESSING' | 'ISSUED' | 'FAILED' | 'REVOKED' | 'SUPERSEDED';
  verificationCode: string;
  registrationNumber: string;
  identityKey: string;
  downloadUrl?: string;
  reused: boolean;
}

@Injectable()
export class IssueCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_REPOSITORY)
    private readonly certificates: CertificateRepositoryPort,
    @Inject(CERTIFICATE_RENDERER)
    private readonly renderer: CertificateRendererPort,
    @Inject(CERTIFICATE_STORAGE)
    private readonly storage: CertificateStoragePort,
    @Inject(CERTIFICATE_ISSUANCE_CONFIG)
    private readonly config: CertificateIssuanceConfig,
  ) {}

  async execute(
    command: IssueCertificateCommand,
  ): Promise<IssueCertificateResult> {
    const input = command.input;
    const identity = CertificateIdentity.create({
      externalStudentId: input.externalStudentId,
      courseId: input.courseId,
      deliveryMode: input.deliveryMode,
      classId: input.classId,
    });

    if (!this.config.institutionName) {
      throw new Error('CERTIFICATE_INSTITUTION_NAME must be configured');
    }
    if (
      this.config.environment === 'production' &&
      (this.config.institutionName === 'Instituição de Teste' ||
        input.studentName === 'Aluno de Teste' ||
        input.courseTitle === 'Curso de Demonstração')
    ) {
      throw new TestDataNotAllowedError();
    }

    const snapshot = {
      institutionName: this.config.institutionName,
      studentName: input.studentName,
      courseTitle: input.courseTitle,
      workloadHours: input.workloadHours,
      completionDate: input.completionDate,
      deliveryMode: input.deliveryMode,
      classId: input.classId ?? null,
      responsibleName: input.responsibleName ?? null,
      responsibleRole: input.responsibleRole ?? null,
    };

    const reservation = await this.certificates.reserve({
      integrationId: command.integrationId,
      clientDbId: command.clientDbId,
      institutionId: command.institutionId,
      identityKey: identity.key,
      externalStudentId: identity.externalStudentId,
      courseId: identity.courseId,
      deliveryMode: identity.deliveryMode,
      classId: identity.classId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      certificateType: input.certificateType ?? 'standard',
      templateVersion: this.config.templateVersion,
      snapshot,
      registrationYear: new Date().getUTCFullYear(),
    });

    if (!reservation.created || reservation.status !== 'PROCESSING') {
      const downloadUrl =
        reservation.status === 'ISSUED' && reservation.objectKey
          ? await this.storage.createDownloadUrl(
              reservation.objectKey,
              DOWNLOAD_URL_TTL_SECONDS,
            )
          : undefined;
      return {
        certificateId: reservation.certificateId,
        status: reservation.status,
        verificationCode: reservation.verificationCode,
        registrationNumber: reservation.registrationNumber,
        identityKey: identity.key,
        downloadUrl,
        reused: true,
      };
    }

    const objectKey = `${command.integrationId}/certificates/${reservation.certificateId}.pdf`;
    let uploadedObjectKey: string | undefined;

    try {
      const verificationUrl = `${this.config.verificationBaseUrl.replace(/\/$/, '')}/${reservation.verificationCode}`;
      const pdf = await this.renderer.render({
        snapshot,
        registrationNumber: reservation.registrationNumber,
        verificationCode: reservation.verificationCode,
        verificationUrl,
        markAsTest: this.config.environment !== 'production',
      });
      const stored = await this.storage.putPdf(objectKey, pdf);
      uploadedObjectKey = stored.objectKey;

      await this.certificates.markIssued({
        certificateId: reservation.certificateId,
        clientDbId: command.clientDbId,
        idempotencyKey: command.idempotencyKey,
        objectKey: stored.objectKey,
        pdfSha256: stored.sha256,
        pdfSizeBytes: stored.sizeBytes,
        requestId: command.requestId,
        clientId: command.clientId,
      });

      const downloadUrl = await this.storage.createDownloadUrl(
        stored.objectKey,
        DOWNLOAD_URL_TTL_SECONDS,
      );
      return {
        certificateId: reservation.certificateId,
        status: 'ISSUED',
        verificationCode: reservation.verificationCode,
        registrationNumber: reservation.registrationNumber,
        identityKey: identity.key,
        downloadUrl,
        reused: false,
      };
    } catch (error) {
      if (uploadedObjectKey) {
        await this.storage
          .deleteObject(uploadedObjectKey)
          .catch(() => undefined);
      }
      await this.certificates.markFailed({
        certificateId: reservation.certificateId,
        requestId: command.requestId,
        clientId: command.clientId,
        clientDbId: command.clientDbId,
        idempotencyKey: command.idempotencyKey,
        failureCode: 'ISSUANCE_FAILED',
      });
      if (error instanceof CertificateConflictError) {
        throw error;
      }
      throw error;
    }
  }

  static hashRequest(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }
}
