import { Inject, Injectable } from '@nestjs/common';
import type { CertificateSnapshot } from '../../domain/entities/certificate-snapshot';
import { isCertificateId } from '../../domain/certificate-id';
import { DOWNLOAD_URL_TTL_SECONDS } from '../../domain/certificate.constants';
import { CERTIFICATE_ISSUANCE_CONFIG } from '../ports/certificate-issuance-config.port';
import type { CertificateIssuanceConfig } from '../ports/certificate-issuance-config.port';
import { CERTIFICATE_RENDERER } from '../ports/certificate-renderer.port';
import type { CertificateRendererPort } from '../ports/certificate-renderer.port';
import { CERTIFICATE_REPOSITORY } from '../ports/certificate-repository.port';
import type { CertificateRepositoryPort } from '../ports/certificate-repository.port';
import { CERTIFICATE_STORAGE } from '../ports/certificate-storage.port';
import type { CertificateStoragePort } from '../ports/certificate-storage.port';
import { CertificateConflictError } from '../errors/certificate-conflict.error';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { TestDataNotAllowedError } from '../errors/test-data-not-allowed.error';
import { ReissueCertificateDto } from '../../presentation/dto/reissue-certificate.dto';

export interface ReissueCertificateCommand {
  integrationId: string;
  institutionId: string;
  clientDbId: string;
  clientId: string;
  certificateId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  input: ReissueCertificateDto;
}

export interface ReissueCertificateResult {
  certificateId: string;
  previousCertificateId: string | null;
  status: 'PROCESSING' | 'ISSUED' | 'FAILED' | 'REVOKED' | 'SUPERSEDED';
  verificationCode: string;
  registrationNumber: string;
  downloadUrl?: string;
  reused: boolean;
}

@Injectable()
export class ReissueCertificateUseCase {
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
    command: ReissueCertificateCommand,
  ): Promise<ReissueCertificateResult> {
    if (!isCertificateId(command.certificateId)) {
      throw new CertificateNotFoundError();
    }
    const input = command.input;
    this.rejectProductionPlaceholders(input.studentName, input.courseTitle);
    const snapshot: CertificateSnapshot = {
      institutionName: this.config.institutionName,
      studentName: input.studentName,
      courseTitle: input.courseTitle,
      workloadHours: input.workloadHours,
      completionDate: input.completionDate,
      deliveryMode: 'online',
      classId: null,
      responsibleName: input.responsibleName ?? null,
      responsibleRole: input.responsibleRole ?? null,
    };

    const reservation = await this.certificates.reserveReissue({
      integrationId: command.integrationId,
      clientDbId: command.clientDbId,
      institutionId: command.institutionId,
      certificateId: command.certificateId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      templateVersion: this.config.templateVersion,
      snapshot,
      registrationYear: new Date().getUTCFullYear(),
    });

    if (!reservation.created || reservation.status !== 'PROCESSING') {
      return this.toResult(reservation, reservation.snapshot, true);
    }
    if (!reservation.previousCertificateId) {
      throw new CertificateConflictError(
        'Reissue reservation is missing the previous certificate',
      );
    }

    const objectKey = `${command.integrationId}/certificates/${reservation.certificateId}.pdf`;
    let uploadedObjectKey: string | undefined;
    try {
      const verificationUrl = `${this.config.verificationBaseUrl.replace(/\/$/, '')}/${reservation.verificationCode}`;
      const pdf = await this.renderer.render({
        snapshot: reservation.snapshot,
        registrationNumber: reservation.registrationNumber,
        verificationCode: reservation.verificationCode,
        verificationUrl,
        markAsTest: this.config.environment !== 'production',
      });
      const stored = await this.storage.putPdf(objectKey, pdf);
      uploadedObjectKey = stored.objectKey;
      await this.certificates.completeReissue({
        certificateId: reservation.certificateId,
        previousCertificateId: reservation.previousCertificateId,
        clientDbId: command.clientDbId,
        idempotencyKey: command.idempotencyKey,
        objectKey: stored.objectKey,
        pdfSha256: stored.sha256,
        pdfSizeBytes: stored.sizeBytes,
        requestId: command.requestId,
        clientId: command.clientId,
        actorId: input.actorId,
        reason: input.reason,
      });
      const downloadUrl = await this.storage.createDownloadUrl(
        stored.objectKey,
        DOWNLOAD_URL_TTL_SECONDS,
      );
      return {
        certificateId: reservation.certificateId,
        previousCertificateId: reservation.previousCertificateId,
        status: 'ISSUED',
        verificationCode: reservation.verificationCode,
        registrationNumber: reservation.registrationNumber,
        downloadUrl,
        reused: false,
      };
    } catch (error) {
      if (uploadedObjectKey) {
        await this.storage
          .deleteObject(uploadedObjectKey)
          .catch(() => undefined);
      }
      await this.certificates.failReissue({
        certificateId: reservation.certificateId,
        clientDbId: command.clientDbId,
        idempotencyKey: command.idempotencyKey,
        failureCode: 'REISSUE_FAILED',
        requestId: command.requestId,
        clientId: command.clientId,
        actorId: input.actorId,
      });
      throw error;
    }
  }

  private async toResult(
    reservation: {
      certificateId: string;
      previousCertificateId: string | null;
      status: ReissueCertificateResult['status'];
      verificationCode: string;
      registrationNumber: string;
      objectKey: string | null;
    },
    _snapshot: CertificateSnapshot,
    reused: boolean,
  ): Promise<ReissueCertificateResult> {
    const downloadUrl =
      reservation.status === 'ISSUED' && reservation.objectKey
        ? await this.storage.createDownloadUrl(
            reservation.objectKey,
            DOWNLOAD_URL_TTL_SECONDS,
          )
        : undefined;
    return {
      certificateId: reservation.certificateId,
      previousCertificateId: reservation.previousCertificateId,
      status: reservation.status,
      verificationCode: reservation.verificationCode,
      registrationNumber: reservation.registrationNumber,
      downloadUrl,
      reused,
    };
  }

  private rejectProductionPlaceholders(
    studentName: string,
    courseTitle: string,
  ): void {
    if (!this.config.institutionName) {
      throw new Error('CERTIFICATE_INSTITUTION_NAME must be configured');
    }
    if (
      this.config.environment === 'production' &&
      (this.config.institutionName === 'Instituição de Teste' ||
        studentName === 'Aluno de Teste' ||
        courseTitle === 'Curso de Demonstração')
    ) {
      throw new TestDataNotAllowedError();
    }
  }
}
