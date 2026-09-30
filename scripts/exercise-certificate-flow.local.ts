import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { HmacCanonicalizer } from '../src/modules/machine-auth/application/hmac-canonicalizer';

interface SignedResponse {
  status: number;
  body: string;
}

const canonicalizer = new HmacCanonicalizer();

function requireSecret(): { baseUrl: string; clientId: string; secret: Buffer } {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const clientId = process.env.INTEGRATION_CLIENT_ID ?? 'client_local_dev';
  const clientSecret =
    process.env.INTEGRATION_CLIENT_SECRET ?? '0123456789abcdef0123456789abcdef';
  const secret = Buffer.from(clientSecret, 'utf8');
  if (secret.length !== 32) {
    throw new Error('INTEGRATION_CLIENT_SECRET must contain exactly 32 bytes');
  }
  return { baseUrl, clientId, secret };
}

async function signedRequest(input: {
  method: 'GET' | 'POST';
  path: string;
  rawBody?: Buffer;
  contentType?: string;
}): Promise<SignedResponse> {
  const { baseUrl, clientId, secret } = requireSecret();
  const rawBody = input.rawBody ?? Buffer.alloc(0);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('base64url');
  const idempotencyKey = input.method === 'POST' ? randomUUID() : undefined;
  const signature = canonicalizer.sign(secret, {
    clientId,
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    idempotencyKey,
    rawBody,
  });
  const headers: Record<string, string> = {
    'X-Client-Id': clientId,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
  if (input.contentType) {
    headers['Content-Type'] = input.contentType;
  }
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const response = await fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers,
    body: input.method === 'GET' ? undefined : (rawBody as unknown as BodyInit),
  });
  return { status: response.status, body: await response.text() };
}

function parseJson<T>(response: SignedResponse, expectedStatus: number): T {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected HTTP ${expectedStatus}, received ${response.status}: ${response.body}`,
    );
  }
  return JSON.parse(response.body) as T;
}

async function publicGet(path: string): Promise<SignedResponse> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.text() };
}

async function downloadLocalPdf(downloadUrl: string): Promise<Buffer> {
  const url = new URL(downloadUrl);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname)
  ) {
    throw new Error('Refusing to download from a non-local host');
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PDF download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function exerciseCertificateFlow(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const payload = {
    externalStudentId: `student-flow-${suffix}`,
    courseId: `course-flow-${suffix}`,
    deliveryMode: 'online',
    studentName: 'Aluno de Teste',
    courseTitle: 'Curso de Demonstração',
    workloadHours: 20,
    completionDate: new Date().toISOString().slice(0, 10),
    certificateType: 'standard',
  };
  const issued = parseJson<{
    certificateId: string;
    status: string;
    verificationCode: string;
    identityKey: string;
    downloadUrl?: string;
  }>(
    await signedRequest({
      method: 'POST',
      path: '/v1/certificates',
      contentType: 'application/json',
      rawBody: Buffer.from(JSON.stringify(payload), 'utf8'),
    }),
    201,
  );
  if (issued.status !== 'ISSUED' || !issued.identityKey || !issued.downloadUrl) {
    throw new Error(`Issuance did not complete: ${JSON.stringify(issued)}`);
  }

  const byId = parseJson<{ certificateId: string; identityKey: string }>(
    await signedRequest({
      method: 'GET',
      path: `/v1/certificates/${issued.certificateId}`,
    }),
    200,
  );
  if (byId.identityKey !== issued.identityKey) {
    throw new Error('Private query returned a different identity key');
  }

  const byReference = parseJson<{ certificateId: string }>(
    await signedRequest({
      method: 'GET',
      path: `/v1/certificates/by-reference/${issued.identityKey}`,
    }),
    200,
  );
  if (byReference.certificateId !== issued.certificateId) {
    throw new Error('Reference query did not return the issued certificate');
  }

  const download = parseJson<{ downloadUrl: string; expiresInSeconds: number }>(
    await signedRequest({
      method: 'GET',
      path: `/v1/certificates/${issued.certificateId}/pdf`,
    }),
    200,
  );
  if (download.expiresInSeconds !== 300) {
    throw new Error('Download URL TTL is not 300 seconds');
  }
  const pdf = await downloadLocalPdf(download.downloadUrl);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Downloaded file is not a PDF');
  }

  const matchingCheck = await fetch(
    `${process.env.API_BASE_URL ?? 'http://localhost:3000'}/v1/public/certificates/${issued.verificationCode}/file-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdf as unknown as BodyInit,
    },
  );
  const matchingBody = await matchingCheck.text();
  if (matchingCheck.status !== 200) {
    throw new Error(
      `Matching file-check failed (${matchingCheck.status}): ${matchingBody}`,
    );
  }
  if ((JSON.parse(matchingBody) as { match: boolean }).match !== true) {
    throw new Error('Matching PDF was not recognized');
  }

  const altered = Buffer.from(pdf);
  altered[Math.min(32, altered.length - 1)] ^= 0xff;
  const alteredCheck = await fetch(
    `${process.env.API_BASE_URL ?? 'http://localhost:3000'}/v1/public/certificates/${issued.verificationCode}/file-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: altered,
    },
  );
  const alteredBody = await alteredCheck.text();
  if (alteredCheck.status !== 200) {
    throw new Error(
      `Altered file-check failed (${alteredCheck.status}): ${alteredBody}`,
    );
  }
  if ((JSON.parse(alteredBody) as { match: boolean }).match !== false) {
    throw new Error('Altered PDF was incorrectly accepted');
  }

  const reissuePayload = {
    actorId: 'local-admin',
    reason: 'Correcao de nome no teste local',
    studentName: 'Aluno Corrigido',
    courseTitle: payload.courseTitle,
    workloadHours: payload.workloadHours,
    completionDate: payload.completionDate,
  };
  const reissued = parseJson<{
    certificateId: string;
    previousCertificateId: string | null;
    status: string;
    verificationCode: string;
  }>(
    await signedRequest({
      method: 'POST',
      path: `/v1/certificates/${issued.certificateId}/reissue`,
      contentType: 'application/json',
      rawBody: Buffer.from(JSON.stringify(reissuePayload), 'utf8'),
    }),
    200,
  );
  if (
    reissued.status !== 'ISSUED' ||
    reissued.previousCertificateId !== issued.certificateId ||
    reissued.certificateId === issued.certificateId
  ) {
    throw new Error(`Reissue did not supersede the original: ${JSON.stringify(reissued)}`);
  }

  const replaced = parseJson<{ status: string }>(
    await publicGet(`/v1/public/certificates/${issued.verificationCode}`),
    200,
  );
  if (replaced.status !== 'replaced') {
    throw new Error(`Original code status is ${replaced.status}, expected replaced`);
  }
  const current = parseJson<{ status: string }>(
    await publicGet(`/v1/public/certificates/${reissued.verificationCode}`),
    200,
  );
  if (current.status !== 'valid') {
    throw new Error(`Reissued code status is ${current.status}, expected valid`);
  }

  const revoked = parseJson<{ status: string }>(
    await signedRequest({
      method: 'POST',
      path: `/v1/certificates/${reissued.certificateId}/revoke`,
      contentType: 'application/json',
      rawBody: Buffer.from(
        JSON.stringify({
          actorId: 'local-admin',
          reason: 'Revogacao do certificado criado somente para o teste local',
        }),
        'utf8',
      ),
    }),
    200,
  );
  if (revoked.status !== 'REVOKED') {
    throw new Error(`Revocation did not complete: ${JSON.stringify(revoked)}`);
  }
  const revokedPublic = parseJson<{ status: string }>(
    await publicGet(`/v1/public/certificates/${reissued.verificationCode}`),
    200,
  );
  if (revokedPublic.status !== 'revoked') {
    throw new Error(
      `Revoked code status is ${revokedPublic.status}, expected revoked`,
    );
  }

  const missing = await publicGet('/v1/public/certificates/not-a-code');
  if (missing.status !== 404 || !missing.body.includes('NOT_FOUND')) {
    throw new Error(
      `Unknown code should be 404 NOT_FOUND, received ${missing.status}: ${missing.body}`,
    );
  }

  console.log(
    `Flow ok: issued ${issued.certificateId}, reissued ${reissued.certificateId}, revoked`,
  );
}

exerciseCertificateFlow().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local flow failed');
  process.exitCode = 1;
});
