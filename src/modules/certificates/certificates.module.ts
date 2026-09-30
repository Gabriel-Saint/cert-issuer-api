import { Module } from '@nestjs/common';
import { DownloadCertificateUseCase } from './application/use-cases/download-certificate.use-case';
import { FileCheckCertificateUseCase } from './application/use-cases/file-check-certificate.use-case';
import { GetCertificateByReferenceUseCase } from './application/use-cases/get-certificate-by-reference.use-case';
import { GetCertificateUseCase } from './application/use-cases/get-certificate.use-case';
import { IssueCertificateUseCase } from './application/use-cases/issue-certificate.use-case';
import { ReissueCertificateUseCase } from './application/use-cases/reissue-certificate.use-case';
import { RevokeCertificateUseCase } from './application/use-cases/revoke-certificate.use-case';
import { VerifyPublicCertificateUseCase } from './application/use-cases/verify-public-certificate.use-case';
import { AUDIT_WRITER } from './application/ports/audit-writer.port';
import { CERTIFICATE_ISSUANCE_CONFIG } from './application/ports/certificate-issuance-config.port';
import { CERTIFICATE_RENDERER } from './application/ports/certificate-renderer.port';
import { CERTIFICATE_REPOSITORY } from './application/ports/certificate-repository.port';
import { CERTIFICATE_STORAGE } from './application/ports/certificate-storage.port';
import { CERTIFICATE_QUERY_REPOSITORY } from './application/ports/certificate-query-repository.port';
import { PrismaAuditWriter } from './infrastructure/persistence/prisma-audit.writer';
import { PrismaCertificateRepository } from './infrastructure/persistence/prisma-certificate.repository';
import { PrismaCertificateQueryRepository } from './infrastructure/persistence/prisma-certificate-query.repository';
import { PlaywrightCertificateRenderer } from './infrastructure/renderer/playwright-certificate.renderer';
import { S3CertificateStorage } from './infrastructure/storage/s3-certificate.storage';
import { CertificatesController } from './presentation/certificates.controller';
import { PublicCertificatesController } from './presentation/public-certificates.controller';

@Module({
  controllers: [CertificatesController, PublicCertificatesController],
  providers: [
    IssueCertificateUseCase,
    GetCertificateUseCase,
    GetCertificateByReferenceUseCase,
    DownloadCertificateUseCase,
    RevokeCertificateUseCase,
    ReissueCertificateUseCase,
    FileCheckCertificateUseCase,
    VerifyPublicCertificateUseCase,
    PrismaAuditWriter,
    PrismaCertificateRepository,
    PrismaCertificateQueryRepository,
    PlaywrightCertificateRenderer,
    S3CertificateStorage,
    {
      provide: CERTIFICATE_REPOSITORY,
      useExisting: PrismaCertificateRepository,
    },
    { provide: AUDIT_WRITER, useExisting: PrismaAuditWriter },
    {
      provide: CERTIFICATE_QUERY_REPOSITORY,
      useExisting: PrismaCertificateQueryRepository,
    },
    {
      provide: CERTIFICATE_RENDERER,
      useExisting: PlaywrightCertificateRenderer,
    },
    { provide: CERTIFICATE_STORAGE, useExisting: S3CertificateStorage },
    {
      provide: CERTIFICATE_ISSUANCE_CONFIG,
      useFactory: () => {
        const environment = process.env.NODE_ENV ?? 'development';
        return {
          environment,
          institutionName:
            process.env.CERTIFICATE_INSTITUTION_NAME ??
            (environment === 'production' ? '' : 'Instituição de Teste'),
          templateVersion:
            process.env.CERTIFICATE_TEMPLATE_VERSION ?? 'test-v1',
          verificationBaseUrl:
            process.env.VERIFICATION_BASE_URL ??
            'http://localhost:3000/v1/public/certificates',
        };
      },
    },
  ],
})
export class CertificatesModule {}
