export class TestDataNotAllowedError extends Error {
  readonly code = 'TEST_DATA_NOT_ALLOWED';

  constructor() {
    super('Test placeholders are not allowed in production');
    this.name = 'TestDataNotAllowedError';
  }
}
