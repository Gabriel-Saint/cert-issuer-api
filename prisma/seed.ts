import 'dotenv/config';
import { IntegrationStatus, PrismaClient } from '@prisma/client';
import { SecretProtector } from '../src/modules/machine-auth/infrastructure/secret-protector';

async function seedLocalIntegration(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Local seed is disabled in production');
  }

  const namespace = process.env.INTEGRATION_NAMESPACE ?? 'local-development';
  const institutionId = process.env.INSTITUTION_ID ?? 'local-institution';
  const clientId = process.env.INTEGRATION_CLIENT_ID ?? 'client_local_dev';
  const clientSecret =
    process.env.INTEGRATION_CLIENT_SECRET ?? '0123456789abcdef0123456789abcdef';
  if (Buffer.byteLength(clientSecret, 'utf8') !== 32) {
    throw new Error('INTEGRATION_CLIENT_SECRET must contain exactly 32 bytes');
  }

  const prisma = new PrismaClient();
  try {
    const integration = await prisma.integration.upsert({
      where: { namespace },
      update: {
        displayName: 'Integração local de desenvolvimento',
        institutionId,
        status: IntegrationStatus.ACTIVE,
      },
      create: {
        namespace,
        displayName: 'Integração local de desenvolvimento',
        institutionId,
        status: IntegrationStatus.ACTIVE,
      },
    });
    const secretCiphertext = new SecretProtector().encrypt(clientSecret);

    await prisma.integrationClient.upsert({
      where: { clientId },
      update: {
        integrationId: integration.id,
        secretCiphertext,
        secretKeyVersion: 'local-v1',
        scopes: ['issue', 'read', 'revoke'],
        status: IntegrationStatus.ACTIVE,
        revokedAt: null,
      },
      create: {
        clientId,
        integrationId: integration.id,
        secretCiphertext,
        secretKeyVersion: 'local-v1',
        scopes: ['issue', 'read', 'revoke'],
        status: IntegrationStatus.ACTIVE,
      },
    });

    console.log(`Local integration seeded: ${clientId}`);
  } finally {
    await prisma.$disconnect();
  }
}

seedLocalIntegration().catch((error: unknown) => {
  console.error(
    'Local seed failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
