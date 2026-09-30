export class DependencyUnavailableError extends Error {
  readonly code = 'DEPENDENCY_UNAVAILABLE';
  readonly retryAfterSeconds = 1;

  constructor() {
    super('Dependency unavailable');
    this.name = 'DependencyUnavailableError';
  }
}
