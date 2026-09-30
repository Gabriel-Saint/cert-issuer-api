export class RequestTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT';
  readonly retryAfterSeconds = 1;

  constructor() {
    super('Request timed out');
    this.name = 'RequestTimeoutError';
  }
}
