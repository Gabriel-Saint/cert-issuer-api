import type { Request, Response } from 'express';

export interface ProblemFieldError {
  field?: string;
  detail: string;
}

export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  errors?: ProblemFieldError[];
}

const TITLES: Record<string, string> = {
  VALIDATION_ERROR: 'Validation failed',
  MALFORMED_REQUEST: 'Malformed request',
  AUTHENTICATION_FAILED: 'Authentication failed',
  INSUFFICIENT_SCOPE: 'Insufficient scope',
  NOT_FOUND: 'Resource not found',
  IDEMPOTENCY_CONFLICT: 'Idempotency conflict',
  CERTIFICATE_CONFLICT: 'Certificate conflict',
  STATE_CONFLICT: 'State conflict',
  TEST_DATA_NOT_ALLOWED: 'Test data is not allowed',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  INVALID_TRANSITION: 'Invalid transition',
  UNSUPPORTED_CERTIFICATE_TYPE: 'Unsupported certificate type',
  RATE_LIMITED: 'Rate limit exceeded',
  REQUEST_TIMEOUT: 'Request timed out',
  DEPENDENCY_UNAVAILABLE: 'Dependency unavailable',
  RAW_BODY_UNAVAILABLE: 'Raw body unavailable',
  INTERNAL_ERROR: 'Internal error',
};

const DETAILS: Record<string, string> = {
  VALIDATION_ERROR: 'One or more fields are invalid.',
  MALFORMED_REQUEST: 'The request could not be read.',
  AUTHENTICATION_FAILED: 'Authentication failed.',
  INSUFFICIENT_SCOPE: 'The credential does not have the required scope.',
  NOT_FOUND: 'The requested resource was not found.',
  IDEMPOTENCY_CONFLICT:
    'Idempotency-Key was already used with a different request body.',
  CERTIFICATE_CONFLICT:
    'The certificate identity conflicts with existing data.',
  STATE_CONFLICT: 'The certificate state does not allow this operation.',
  TEST_DATA_NOT_ALLOWED: 'Test placeholders are not allowed in production.',
  PAYLOAD_TOO_LARGE: 'The payload exceeds the allowed limit.',
  UNSUPPORTED_MEDIA_TYPE: 'The content type is not supported.',
  INVALID_TRANSITION:
    'The certificate cannot transition from its current state.',
  UNSUPPORTED_CERTIFICATE_TYPE: 'The certificate type is not supported.',
  RATE_LIMITED: 'Too many requests.',
  REQUEST_TIMEOUT: 'The request exceeded its deadline.',
  DEPENDENCY_UNAVAILABLE: 'A required dependency is unavailable.',
  RAW_BODY_UNAVAILABLE: 'The raw request body is unavailable.',
  INTERNAL_ERROR: 'The request could not be completed.',
};

export const STATUS_BY_CODE: Record<string, number> = {
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
  INTERNAL_ERROR: 500,
};

export function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'MALFORMED_REQUEST';
    case 401:
      return 'AUTHENTICATION_FAILED';
    case 403:
      return 'INSUFFICIENT_SCOPE';
    case 404:
      return 'NOT_FOUND';
    case 408:
      return 'REQUEST_TIMEOUT';
    case 409:
      return 'STATE_CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 422:
      return 'INVALID_TRANSITION';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

export function buildProblem(input: {
  code: string;
  requestId: string;
  status?: number;
  errors?: ProblemFieldError[];
}): ProblemDetails {
  const code = TITLES[input.code] ? input.code : 'INTERNAL_ERROR';
  return {
    type: 'about:blank',
    title: TITLES[code],
    status: input.status ?? STATUS_BY_CODE[code] ?? 500,
    detail: DETAILS[code],
    code,
    requestId: input.requestId,
    ...(input.errors && input.errors.length > 0
      ? { errors: input.errors }
      : {}),
  };
}

export function writeProblem(
  response: Response,
  problem: ProblemDetails,
  extraHeaders: Record<string, string> = {},
): void {
  response.status(problem.status);
  response.setHeader('Content-Type', 'application/problem+json');
  response.setHeader('X-Request-Id', problem.requestId);
  for (const [name, value] of Object.entries(extraHeaders)) {
    response.setHeader(name, value);
  }
  response.json(problem);
}

export function readRequestIdFrom(request: Request): string {
  const header = request.header('x-request-id');
  if (header && /^[A-Za-z0-9_-]{8,128}$/.test(header)) {
    return header;
  }
  const attached = (request as Request & { requestId?: string }).requestId;
  return attached && attached.length > 0 ? attached : 'unknown';
}
