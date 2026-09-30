import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/persistence/prisma.service';
import {
  AuditEventInput,
  AuditWriterPort,
} from '../../application/ports/audit-writer.port';

@Injectable()
export class PrismaAuditWriter implements AuditWriterPort {
  constructor(private readonly prisma: PrismaService) {}

  async write(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        integrationId: event.integrationId,
        clientId: event.clientId,
        actorId: event.actorId ?? null,
        eventType: event.eventType,
        outcome: event.outcome,
        requestId: event.requestId,
        reference: event.reference,
        details: event.details,
      },
    });
  }
}
