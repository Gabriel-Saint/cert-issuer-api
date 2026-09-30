const CERTIFICATE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCertificateId(value: string): boolean {
  return CERTIFICATE_ID_PATTERN.test(value);
}
