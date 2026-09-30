import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import {
  CertificateStoragePort,
  StoredCertificateFile,
} from '../../application/ports/certificate-storage.port';

@Injectable()
export class S3CertificateStorage
  implements CertificateStoragePort, OnModuleDestroy
{
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const production = config.get<string>('NODE_ENV') === 'production';
    this.bucket = config.get<string>('S3_BUCKET') ?? 'certificate-pdfs';
    const endpoint =
      config.get<string>('S3_ENDPOINT') ?? 'http://localhost:9000';
    const accessKeyId = config.get<string>('S3_ACCESS_KEY') ?? 'local-minio';
    const secretAccessKey =
      config.get<string>('S3_SECRET_KEY') ?? 'local-minio-password';

    if (
      production &&
      (!config.get('S3_BUCKET') ||
        !config.get('S3_ENDPOINT') ||
        !config.get('S3_ACCESS_KEY') ||
        !config.get('S3_SECRET_KEY'))
    ) {
      throw new Error('S3 production configuration is incomplete');
    }

    this.client = new S3Client({
      endpoint,
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async putPdf(objectKey: string, pdf: Buffer): Promise<StoredCertificateFile> {
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: pdf,
        ContentType: 'application/pdf',
        CacheControl: 'private, no-store',
        Metadata: { sha256 },
      }),
    );

    return { objectKey, sha256, sizeBytes: pdf.length };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }

  async createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    );
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
