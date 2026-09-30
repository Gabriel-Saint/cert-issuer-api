export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

export interface AuditEventInput {
  integrationId: string;
  clientId: string;
  actorId?: string | null;
  eventType: string;
  outcome: 'success' | 'failure';
  requestId: string;
  reference: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface AuditWriterPort {
  write(event: AuditEventInput): Promise<void>;
}
