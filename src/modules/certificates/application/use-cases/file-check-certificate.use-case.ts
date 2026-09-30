import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { RequestTimeoutError } from '../errors/request-timeout.error';
import { CERTIFICATE_QUERY_REPOSITORY } from '../ports/certificate-query-repository.port';
import type { CertificateQueryRepositoryPort } from '../ports/certificate-query-repository.port';

export interface FileCheckResult {
  match: boolean;
}

@Injectable()
export class FileCheckCertificateUseCase {
  constructor(
    @Inject(CERTIFICATE_QUERY_REPOSITORY)
    private readonly certificates: CertificateQueryRepositoryPort,
  ) {}

  async execute(code: string, sha256: string): Promise<FileCheckResult> {
    const storedHash = await withTimeout(
      this.certificates.findComparableHash(code),
      15_000,
    );
    if (!storedHash) {
      throw new CertificateNotFoundError();
    }
    return { match: hashesMatch(storedHash, sha256) };
  }
}

function hashesMatch(storedHash: string, receivedHash: string): boolean {
  if (
    !/^[0-9a-f]{64}$/.test(storedHash) ||
    !/^[0-9a-f]{64}$/.test(receivedHash)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    Buffer.from(receivedHash, 'hex'),
  );
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RequestTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
