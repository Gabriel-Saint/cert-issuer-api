import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type RequestWithId = Request & { requestId?: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const incoming = request.header('x-request-id');
    const requestId =
      incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  }
}

export function readRequestId(request: Request): string {
  const requestId = (request as RequestWithId).requestId;
  return requestId && requestId.length > 0 ? requestId : 'unknown';
}
