/**
 * Script de teste manual da API via linha de comando.
 *
 * Uso:
 *   npx ts-node scripts/test-api.ts emitir
 *   npx ts-node scripts/test-api.ts consultar <certificateId>
 *   npx ts-node scripts/test-api.ts download <certificateId>
 *   npx ts-node scripts/test-api.ts revogar <certificateId>
 *   npx ts-node scripts/test-api.ts verificar <verificationCode>
 *   npx ts-node scripts/test-api.ts health
 */

import 'dotenv/config';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';

const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CLIENT_ID = process.env.INTEGRATION_CLIENT_ID ?? 'client_local_dev';
const SECRET = Buffer.from(
  process.env.INTEGRATION_CLIENT_SECRET ?? '0123456789abcdef0123456789abcdef',
  'utf8',
);

function sign(method: string, path: string, body: Buffer, idempotencyKey?: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('base64url');
  const bodyHash = createHash('sha256').update(body).digest('hex');

  const canonical = [
    'cert-api-hmac-v1',
    CLIENT_ID,
    method,
    path,
    timestamp,
    nonce,
    idempotencyKey ?? '',
    bodyHash,
  ].join('\n');

  const signature = createHmac('sha256', SECRET).update(canonical, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'X-Client-Id': CLIENT_ID,
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return headers;
}

async function request(method: string, path: string, body?: object) {
  const rawBody = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0);
  const idempotencyKey = method === 'POST' ? randomUUID() : undefined;
  const authHeaders = sign(method, path, rawBody, idempotencyKey);

  const headers: Record<string, string> = { ...authHeaders };
  if (body) headers['Content-Type'] = 'application/json';

  console.log(`\n→ ${method} ${BASE_URL}${path}`);
  if (body) console.log('  Body:', JSON.stringify(body, null, 2));

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? (rawBody as unknown as BodyInit) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  console.log(`\n← HTTP ${res.status}`);
  console.log(JSON.stringify(parsed, null, 2));
  return { status: res.status, body: parsed };
}

async function publicGet(path: string) {
  console.log(`\n→ GET ${BASE_URL}${path} (público)`);
  const res = await fetch(`${BASE_URL}${path}`);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  console.log(`\n← HTTP ${res.status}`);
  console.log(JSON.stringify(parsed, null, 2));
}

// ─── Comandos ────────────────────────────────────────────────────────────────

const [, , cmd, arg] = process.argv;

async function main() {
  switch (cmd) {

    case 'health': {
      await publicGet('/v1/health');
      await publicGet('/v1/health/ready');
      break;
    }

    case 'emitir': {
      await request('POST', '/v1/certificates', {
        externalStudentId: `aluno-cmd-${Date.now()}`,
        courseId: `curso-cmd-${Date.now()}`,
        deliveryMode: 'online',
        studentName: 'Aluno de Teste',
        courseTitle: 'Curso de Demonstração',
        workloadHours: 40,
        completionDate: new Date().toISOString().slice(0, 10),
        certificateType: 'standard',
        responsibleName: 'Prof. Responsável',
        responsibleRole: 'Coordenador',
      });
      console.log('\n💡 Copie o certificateId e verificationCode acima para usar nos próximos comandos.');
      break;
    }

    case 'consultar': {
      if (!arg) { console.error('Uso: test-api.ts consultar <certificateId>'); process.exit(1); }
      await request('GET', `/v1/certificates/${arg}`);
      break;
    }

    case 'download': {
      if (!arg) { console.error('Uso: test-api.ts download <certificateId>'); process.exit(1); }
      await request('GET', `/v1/certificates/${arg}/pdf`);
      console.log('\n💡 Abra o downloadUrl no navegador para baixar o PDF.');
      break;
    }

    case 'revogar': {
      if (!arg) { console.error('Uso: test-api.ts revogar <certificateId>'); process.exit(1); }
      await request('POST', `/v1/certificates/${arg}/revoke`, {
        actorId: 'admin-cmd',
        reason: 'Teste de revogação via terminal',
      });
      break;
    }

    case 'verificar': {
      if (!arg) { console.error('Uso: test-api.ts verificar <verificationCode>'); process.exit(1); }
      await publicGet(`/v1/public/certificates/${arg}`);
      break;
    }

    default: {
      console.log(`
Comandos disponíveis:

  npx ts-node scripts/test-api.ts health
  npx ts-node scripts/test-api.ts emitir
  npx ts-node scripts/test-api.ts consultar <certificateId>
  npx ts-node scripts/test-api.ts download  <certificateId>
  npx ts-node scripts/test-api.ts revogar   <certificateId>
  npx ts-node scripts/test-api.ts verificar <verificationCode>
      `);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
