import { HmacCanonicalizer } from './hmac-canonicalizer';

const requestParts = {
  clientId: 'client_test_01',
  method: 'POST',
  path: '/v1/certificates',
  timestamp: '1780000000',
  nonce: 'AAECAwQFBgcICQoLDA0ODw',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
  rawBody: Buffer.from('{"name":"Test Student"}', 'utf8'),
};

describe('HmacCanonicalizer', () => {
  const canonicalizer = new HmacCanonicalizer();
  const secret = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

  it('includes client, request metadata, idempotency key and raw body hash', () => {
    const canonical = canonicalizer.canonicalize(requestParts);

    expect(canonical.split('\n')).toEqual([
      'cert-api-hmac-v1',
      'client_test_01',
      'POST',
      '/v1/certificates',
      '1780000000',
      'AAECAwQFBgcICQoLDA0ODw',
      '123e4567-e89b-42d3-a456-426614174000',
      'c73b53d88f2703c471ea9fe1d9a527f673d13c01eec48c3e14a5f99455ec9ba6',
    ]);
  });

  it('signs and verifies requests', () => {
    const signature = canonicalizer.sign(secret, requestParts);

    expect(canonicalizer.verify(secret, requestParts, signature)).toBe(true);
    expect(canonicalizer.verify(secret, requestParts, 'f'.repeat(64))).toBe(
      false,
    );
  });

  it('binds the signature to the client ID', () => {
    const signature = canonicalizer.sign(secret, requestParts);

    expect(
      canonicalizer.verify(
        secret,
        { ...requestParts, clientId: 'another-client' },
        signature,
      ),
    ).toBe(false);
  });

  it('uses the empty idempotency line on read requests', () => {
    const canonical = canonicalizer.canonicalize({
      ...requestParts,
      idempotencyKey: undefined,
    });

    expect(canonical.split('\n')[6]).toBe('');
  });

  it('rejects a private path containing a query string', () => {
    expect(() =>
      canonicalizer.canonicalize({
        ...requestParts,
        path: '/v1/certificates?limit=1',
      }),
    ).toThrow('path must be a canonical ASCII path without query');
  });

  it('rejects malformed nonce encoding', () => {
    expect(() =>
      canonicalizer.canonicalize({
        ...requestParts,
        nonce: 'not-a-canonical-nonce-value',
      }),
    ).toThrow('nonce must be base64url encoding of 16 random bytes');
  });
});
