import type { Request } from 'express';

export function resolveClientIp(request: Request): string {
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const candidate = trustProxy ? request.ip : request.socket.remoteAddress;
  const ip = candidate && candidate.length > 0 ? candidate : 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}
