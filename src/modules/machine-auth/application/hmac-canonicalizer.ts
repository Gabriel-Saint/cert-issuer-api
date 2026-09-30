import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface HmacRequestParts {
  clientId: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  idempotencyKey?: string;
  rawBody: Buffer;
}

@Injectable()
export class HmacCanonicalizer {
  canonicalize(request: HmacRequestParts): string {
    this.validate(request);

    const bodyHash = createHash('sha256').update(request.rawBody).digest('hex');

    return [
      'cert-api-hmac-v1',
      request.clientId,
      request.method,
      request.path,
      request.timestamp,
      request.nonce,
      request.idempotencyKey ?? '',
      bodyHash,
    ].join('\n');
  }

  sign(secret: Buffer, request: HmacRequestParts): string {
    if (secret.length !== 32) {
      throw new Error('HMAC secret must contain exactly 32 bytes');
    }

    return createHmac('sha256', secret)
      .update(this.canonicalize(request), 'utf8')
      .digest('hex');
  }

  verify(
    secret: Buffer,
    request: HmacRequestParts,
    suppliedSignature: string,
  ): boolean {
    if (!/^[0-9a-f]{64}$/.test(suppliedSignature)) {
      return false;
    }

    const expected = Buffer.from(this.sign(secret, request), 'hex');
    const supplied = Buffer.from(suppliedSignature, 'hex');
    return timingSafeEqual(expected, supplied);
  }

  private validate(request: HmacRequestParts): void {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(request.clientId)) {
      throw new Error('clientId has an invalid format');
    }
    if (!/^[A-Z]+$/.test(request.method)) {
      throw new Error('method must use uppercase ASCII letters');
    }
    if (
      !request.path.startsWith('/') ||
      request.path.includes('?') ||
      request.path.includes('#') ||
      request.path.includes('\\') ||
      /[^\x21-\x7e]/.test(request.path) ||
      /%(?![0-9A-F]{2})/.test(request.path)
    ) {
      throw new Error('path must be a canonical ASCII path without query');
    }
    if (!/^[1-9][0-9]{0,11}$/.test(request.timestamp)) {
      throw new Error('timestamp must be Unix seconds without leading zeros');
    }
    if (!/^[A-Za-z0-9_-]{22}$/.test(request.nonce)) {
      throw new Error('nonce must be base64url encoding of 16 random bytes');
    }

    const nonceBytes = Buffer.from(request.nonce, 'base64url');
    if (
      nonceBytes.length !== 16 ||
      nonceBytes.toString('base64url') !== request.nonce
    ) {
      throw new Error('nonce must be canonical base64url');
    }

    if (
      request.idempotencyKey !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        request.idempotencyKey,
      )
    ) {
      throw new Error('Idempotency-Key must be a lowercase canonical UUID');
    }

    if (!Buffer.isBuffer(request.rawBody)) {
      throw new Error('rawBody must be a Buffer');
    }
  }
}
