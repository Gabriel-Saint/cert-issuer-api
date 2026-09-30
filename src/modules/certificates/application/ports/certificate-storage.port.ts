export const CERTIFICATE_STORAGE = Symbol('CERTIFICATE_STORAGE');

export interface StoredCertificateFile {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface CertificateStoragePort {
  putPdf(objectKey: string, pdf: Buffer): Promise<StoredCertificateFile>;
  deleteObject(objectKey: string): Promise<void>;
  createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number,
  ): Promise<string>;
}
