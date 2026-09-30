import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretProtector {
  encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new Error('Secret must not be empty');
    }

    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      nonce.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const [version, nonceText, tagText, ciphertextText, extra] =
      envelope.split(':');
    if (
      version !== 'v1' ||
      !nonceText ||
      !tagText ||
      ciphertextText === undefined ||
      extra
    ) {
      throw new Error('Unsupported secret envelope');
    }

    const nonce = this.decodeCanonicalBase64Url(nonceText);
    const tag = this.decodeCanonicalBase64Url(tagText);
    const ciphertext = this.decodeCanonicalBase64Url(ciphertextText);
    if (nonce.length !== 12 || tag.length !== 16) {
      throw new Error('Invalid secret envelope');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.getKey(), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    const encodedKey = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
    if (!encodedKey) {
      throw new Error('INTEGRATION_SECRET_ENCRYPTION_KEY is required');
    }

    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new Error(
        'INTEGRATION_SECRET_ENCRYPTION_KEY must be canonical base64 for 32 bytes',
      );
    }
    return key;
  }

  private decodeCanonicalBase64Url(value: string): Buffer {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      throw new Error('Invalid secret envelope encoding');
    }
    return decoded;
  }
}
