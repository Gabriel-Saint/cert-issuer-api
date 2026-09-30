import { createHash } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request } from 'express';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const INACTIVITY_MS = 15_000;
const DEADLINE_MS = 120_000;
const PDF_HEADER = Buffer.from('%PDF-');

export function readPdfSha256(request: Request): Promise<string> {
  const contentType = request.header('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/pdf')) {
    throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  const declaredLength = Number(request.header('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE' });
  }

  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let size = 0;
    let settled = false;
    let header = Buffer.alloc(0);
    let headerChecked = false;
    let inactivityTimer: NodeJS.Timeout;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(inactivityTimer);
      clearTimeout(deadlineTimer);
      request.destroy();
      reject(error);
    };
    const succeed = (digest: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(inactivityTimer);
      clearTimeout(deadlineTimer);
      resolve(digest);
    };
    const armInactivity = (): void => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        fail(timeoutError());
      }, INACTIVITY_MS);
    };

    armInactivity();
    const deadlineTimer = setTimeout(() => fail(timeoutError()), DEADLINE_MS);

    request.on('data', (chunk: Buffer | string) => {
      armInactivity();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_PDF_BYTES) {
        fail(new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      if (!headerChecked) {
        header = Buffer.concat([header, bytes]).subarray(0, PDF_HEADER.length);
        if (header.length >= PDF_HEADER.length) {
          headerChecked = true;
          if (!header.equals(PDF_HEADER)) {
            fail(invalidPdf());
            return;
          }
        }
      }
      hash.update(bytes);
    });
    request.on('end', () => {
      if (size === 0 || !headerChecked) {
        fail(invalidPdf());
        return;
      }
      succeed(hash.digest('hex'));
    });
    request.on('error', () => {
      fail(new BadRequestException({ code: 'MALFORMED_REQUEST' }));
    });
    request.resume();
  });
}

function timeoutError(): HttpException {
  return new HttpException(
    { code: 'REQUEST_TIMEOUT', retryAfterSeconds: 1 },
    408,
  );
}

function invalidPdf(): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    errors: [{ field: 'file', detail: 'file must be a PDF' }],
  });
}
