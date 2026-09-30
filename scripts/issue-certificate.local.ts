import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HmacCanonicalizer } from '../src/modules/machine-auth/application/hmac-canonicalizer';

interface IssueResponse {
  certificateId: string;
  status: string;
  verificationCode: string;
  registrationNumber: string;
  downloadUrl?: string;
}

async function issueLocalCertificate(): Promise<void> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  const clientId = process.env.INTEGRATION_CLIENT_ID ?? 'client_local_dev';
  const clientSecret =
    process.env.INTEGRATION_CLIENT_SECRET ?? '0123456789abcdef0123456789abcdef';
  const secret = Buffer.from(clientSecret, 'utf8');
  if (secret.length !== 32) {
    throw new Error('INTEGRATION_CLIENT_SECRET must contain exactly 32 bytes');
  }

  const payload = {
    externalStudentId: 'student-demo-001',
    courseId: 'course-demo-001',
    deliveryMode: 'online',
    studentName: 'Aluno de Teste',
    courseTitle: 'Curso de Demonstração',
    workloadHours: 20,
    completionDate: new Date().toISOString().slice(0, 10),
    certificateType: 'standard',
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('base64url');
  const idempotencyKey = randomUUID();
  const signature = new HmacCanonicalizer().sign(secret, {
    clientId,
    method: 'POST',
    path: '/v1/certificates',
    timestamp,
    nonce,
    idempotencyKey,
    rawBody,
  });

  const response = await fetch(`${baseUrl}/v1/certificates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature,
      'Idempotency-Key': idempotencyKey,
    },
    body: rawBody,
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Issue request failed (${response.status}): ${responseText}`,
    );
  }

  const result = JSON.parse(responseText) as IssueResponse;
  console.log(`Certificate ${result.status}: ${result.certificateId}`);
  console.log(`Registration: ${result.registrationNumber}`);
  console.log(`Verification code: ${result.verificationCode}`);

  const verificationResponse = await fetch(
    `${baseUrl}/v1/public/certificates/${result.verificationCode}`,
  );
  if (!verificationResponse.ok) {
    throw new Error(
      `Public verification failed (${verificationResponse.status})`,
    );
  }
  const verification = (await verificationResponse.json()) as {
    status: string;
    studentName: string;
    courseTitle: string;
    institutionName: string;
  };
  console.log(`Public verification: ${verification.status}`);

  if (result.downloadUrl) {
    const downloadUrl = new URL(result.downloadUrl);
    if (
      downloadUrl.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(downloadUrl.hostname)
    ) {
      throw new Error(
        'Local issue script refuses to download from a non-local host',
      );
    }
    const pdfResponse = await fetch(downloadUrl);
    if (!pdfResponse.ok) {
      throw new Error(`PDF download failed (${pdfResponse.status})`);
    }
    const outputDirectory = resolve(process.cwd(), '../../generated');
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = resolve(
      outputDirectory,
      `certificate-test-${result.certificateId}.pdf`,
    );
    await writeFile(outputPath, Buffer.from(await pdfResponse.arrayBuffer()));
    console.log(`Test PDF saved: ${outputPath}`);
  }
}

issueLocalCertificate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local issue failed');
  process.exitCode = 1;
});
