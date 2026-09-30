import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ProblemFieldError,
  buildProblem,
  defaultCodeForStatus,
  readRequestIdFrom,
  writeProblem,
} from './problem-details';

interface ExceptionBody {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  errors?: unknown;
  retryAfterSeconds?: unknown;
  limit?: unknown;
  remaining?: unknown;
  resetSeconds?: unknown;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = readRequestIdFrom(request);
    const resolved = resolveException(exception);
    const problem = buildProblem({
      code: resolved.code,
      status: resolved.status,
      requestId,
      errors: resolved.errors,
    });
    const headers: Record<string, string> = {};
    if (resolved.retryAfterSeconds !== undefined) {
      headers['Retry-After'] = String(resolved.retryAfterSeconds);
    }
    if (resolved.limit !== undefined) {
      headers['RateLimit-Limit'] = String(resolved.limit);
      headers['RateLimit-Remaining'] = String(resolved.remaining ?? 0);
      headers['RateLimit-Reset'] = String(resolved.resetSeconds ?? 0);
    }
    writeProblem(response, problem, headers);
  }
}

function resolveException(exception: unknown): {
  status: number;
  code: string;
  errors?: ProblemFieldError[];
  retryAfterSeconds?: number;
  limit?: number;
  remaining?: number;
  resetSeconds?: number;
} {
  if (isParserError(exception, 'entity.too.large')) {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE' };
  }
  if (isParserError(exception, 'entity.parse.failed')) {
    return { status: 400, code: 'MALFORMED_REQUEST' };
  }

  if (exception instanceof HttpException) {
    const body = asBody(exception.getResponse());
    const status = exception.getStatus();
    if (body?.status === 'not_ready') {
      return {
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        retryAfterSeconds: 1,
      };
    }
    const explicitCode = readCode(body?.code);
    const code = explicitCode ?? defaultCodeForStatus(status);
    return {
      status,
      code,
      errors: readErrors(body),
      retryAfterSeconds: readNumber(body?.retryAfterSeconds),
      limit: readNumber(body?.limit),
      remaining: readNumber(body?.remaining),
      resetSeconds: readNumber(body?.resetSeconds),
    };
  }

  if (exception instanceof Error) {
    const code = readCode((exception as Error & { code?: unknown }).code);
    const retryAfterSeconds = readNumber(
      (exception as Error & { retryAfterSeconds?: unknown }).retryAfterSeconds,
    );
    if (code) {
      return { status: statusFor(code), code, retryAfterSeconds };
    }
  }

  return { status: 500, code: 'INTERNAL_ERROR' };
}

function statusFor(code: string): number {
  return (
    {
      VALIDATION_ERROR: 400,
      MALFORMED_REQUEST: 400,
      AUTHENTICATION_FAILED: 401,
      INSUFFICIENT_SCOPE: 403,
      NOT_FOUND: 404,
      IDEMPOTENCY_CONFLICT: 409,
      CERTIFICATE_CONFLICT: 409,
      STATE_CONFLICT: 409,
      TEST_DATA_NOT_ALLOWED: 409,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      INVALID_TRANSITION: 422,
      UNSUPPORTED_CERTIFICATE_TYPE: 422,
      RATE_LIMITED: 429,
      REQUEST_TIMEOUT: 408,
      DEPENDENCY_UNAVAILABLE: 503,
      RAW_BODY_UNAVAILABLE: 503,
    }[code] ?? 500
  );
}

function asBody(value: unknown): ExceptionBody | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value;
}

function readCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z0-9_]{3,64}$/.test(value)
    ? value
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readErrors(
  body: ExceptionBody | undefined,
): ProblemFieldError[] | undefined {
  if (!body) {
    return undefined;
  }
  if (Array.isArray(body.errors)) {
    const errors = body.errors
      .filter(
        (item): item is { field?: unknown; detail?: unknown } =>
          Boolean(item) && typeof item === 'object',
      )
      .map((item) => ({
        ...(typeof item.field === 'string' ? { field: item.field } : {}),
        detail: typeof item.detail === 'string' ? item.detail : 'Invalid field',
      }))
      .slice(0, 20);
    return errors.length > 0 ? errors : undefined;
  }
  if (Array.isArray(body.message)) {
    const errors = body.message
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 20)
      .map((detail) => ({ detail }));
    return errors.length > 0 ? errors : undefined;
  }
  return undefined;
}

function isParserError(exception: unknown, type: string): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'type' in exception &&
    (exception as { type?: unknown }).type === type
  );
}
