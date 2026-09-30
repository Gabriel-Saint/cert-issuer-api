import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { HmacCanonicalizer } from '../application/hmac-canonicalizer';
import { SecretProtector } from '../infrastructure/secret-protector';
import { MachineAuthGuard } from './machine-auth.guard';

const integrationSecret = '0123456789abcdef0123456789abcdef';
const encryptionKey = Buffer.from(
  '0123456789abcdef0123456789abcdef',
  'utf8',
).toString('base64');

function makeHarness(requiredScopes: string[] = ['issue']) {
  process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = encryptionKey;
  const protector = new SecretProtector();
  const hmac = new HmacCanonicalizer();
  const client = {
    id: 'client-db-id',
    clientId: 'client_test_01',
    secretCiphertext: protector.encrypt(integrationSecret),
    scopes: ['issue'],
    status: 'ACTIVE',
    integration: {
      id: 'integration-db-id',
      namespace: 'consumer-a',
      status: 'ACTIVE',
    },
  };
  const prisma = {
    integrationClient: { findUnique: jest.fn().mockResolvedValue(client) },
    usedNonce: { create: jest.fn().mockResolvedValue({}) },
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredScopes),
  };
  const guard = new MachineAuthGuard(
    prisma as unknown as PrismaService,
    protector,
    hmac,
    reflector as unknown as Reflector,
  );

  const rawBody = Buffer.alloc(0);
  const nonce = randomBytes(16).toString('base64url');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestParts = {
    clientId: client.clientId,
    method: 'GET',
    path: '/v1/private/test',
    timestamp,
    nonce,
    rawBody,
  };
  const request = {
    method: requestParts.method,
    path: requestParts.path,
    originalUrl: requestParts.path,
    headers: {
      'x-client-id': client.clientId,
      'x-timestamp': timestamp,
      'x-nonce': nonce,
      'x-signature': hmac.sign(Buffer.from(integrationSecret), requestParts),
    },
    rawBody,
  };
  const handler = () => undefined;
  const controller = class TestController {};
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controller,
  } as unknown as ExecutionContext;

  return {
    guard,
    context,
    request,
    prisma,
    hmac,
    integrationSecret,
    requestParts,
  };
}

describe('MachineAuthGuard', () => {
  it('accepts a valid signature and attaches integration identity', async () => {
    const { guard, context, request, prisma } = makeHarness();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.machineIntegration).toEqual({
      id: 'integration-db-id',
      namespace: 'consumer-a',
      clientDbId: 'client-db-id',
      clientId: 'client_test_01',
      scopes: ['issue'],
    });
    expect(prisma.usedNonce.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an altered signature without reserving the nonce', async () => {
    const { guard, context, request, prisma } = makeHarness();
    request.headers['x-signature'] = 'f'.repeat(64);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.usedNonce.create).not.toHaveBeenCalled();
  });

  it('rejects a valid machine without the required scope', async () => {
    const { guard, context, prisma } = makeHarness(['revoke']);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.usedNonce.create).toHaveBeenCalledTimes(1);
  });

  it('requires an idempotency key on mutations', async () => {
    const { guard, context, request, prisma } = makeHarness();
    request.method = 'POST';
    request.headers['x-signature'] = 'f'.repeat(64);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.integrationClient.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a nonce already stored for the client', async () => {
    const { guard, context, prisma } = makeHarness();
    prisma.usedNonce.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
