import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../../infrastructure/persistence/prisma.service';
import { HmacCanonicalizer } from '../application/hmac-canonicalizer';
import { SecretProtector } from '../infrastructure/secret-protector';
import { REQUIRED_SCOPES_METADATA } from './require-scopes.decorator';

export interface MachineIntegrationIdentity {
  id: string;
  namespace: string;
  institutionId: string;
  clientDbId: string;
  clientId: string;
  scopes: string[];
}

export type MachineAuthenticatedRequest = RawBodyRequest<Request> & {
  machineIntegration?: MachineIntegrationIdentity;
};

@Injectable()
export class MachineAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretProtector,
    private readonly hmac: HmacCanonicalizer,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<MachineAuthenticatedRequest>();
    const clientId = this.singleHeader(request.headers['x-client-id']);
    const timestamp = this.singleHeader(request.headers['x-timestamp']);
    const nonce = this.singleHeader(request.headers['x-nonce']);
    const signature = this.singleHeader(request.headers['x-signature']);
    const idempotencyKey = this.singleHeader(
      request.headers['idempotency-key'],
    );

    if (
      !clientId ||
      !timestamp ||
      !nonce ||
      !signature ||
      request.originalUrl.includes('?')
    ) {
      throw this.authenticationError();
    }

    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation && !idempotencyKey) {
      throw this.authenticationError();
    }

    const contentEncoding = this.singleHeader(
      request.headers['content-encoding'],
    );
    if (contentEncoding && contentEncoding !== 'identity') {
      throw this.authenticationError();
    }

    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const client = await this.prisma.integrationClient.findUnique({
      where: { clientId },
      include: { integration: true },
    });
    if (
      !client ||
      client.status !== 'ACTIVE' ||
      client.integration.status !== 'ACTIVE'
    ) {
      throw this.authenticationError();
    }

    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > 300
    ) {
      throw this.authenticationError();
    }

    let secret: string;
    try {
      secret = this.secrets.decrypt(client.secretCiphertext);
    } catch {
      throw this.authenticationError();
    }

    const requestParts = {
      clientId,
      method: request.method,
      path: request.path,
      timestamp,
      nonce,
      idempotencyKey,
      rawBody,
    };

    let signatureIsValid: boolean;
    try {
      signatureIsValid = this.hmac.verify(
        Buffer.from(secret, 'utf8'),
        requestParts,
        signature,
      );
    } catch {
      throw this.authenticationError();
    }
    if (!signatureIsValid) {
      throw this.authenticationError();
    }

    try {
      await this.prisma.usedNonce.create({
        data: {
          clientDbId: client.id,
          nonce,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.authenticationError();
      }
      throw error;
    }

    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!requiredScopes.every((scope) => client.scopes.includes(scope))) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_SCOPE' });
    }

    request.machineIntegration = {
      id: client.integration.id,
      namespace: client.integration.namespace,
      institutionId: client.integration.institutionId,
      clientDbId: client.id,
      clientId: client.clientId,
      scopes: client.scopes,
    };
    return true;
  }

  private singleHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private authenticationError(): UnauthorizedException {
    return new UnauthorizedException({ code: 'AUTHENTICATION_FAILED' });
  }
}
