import { SecretProtector } from './secret-protector';

describe('SecretProtector', () => {
  const previousKey = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
  const protector = new SecretProtector();

  beforeEach(() => {
    process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = Buffer.from(
      '0123456789abcdef0123456789abcdef',
      'utf8',
    ).toString('base64');
  });

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = previousKey;
    }
  });

  it('encrypts and decrypts a secret without storing it in plaintext', () => {
    const secret = 'integration-secret-for-test';
    const envelope = protector.encrypt(secret);

    expect(envelope).not.toContain(secret);
    expect(protector.decrypt(envelope)).toBe(secret);
  });

  it('uses a fresh nonce for each encryption', () => {
    const first = protector.encrypt('same-secret');
    const second = protector.encrypt('same-secret');

    expect(first).not.toBe(second);
  });

  it('rejects tampered ciphertext', () => {
    const [version, nonce, tag, ciphertext] = protector
      .encrypt('secret')
      .split(':');
    const changedCiphertext = `${ciphertext?.slice(0, -1)}A`;

    expect(() =>
      protector.decrypt([version, nonce, tag, changedCiphertext].join(':')),
    ).toThrow();
  });
});
