export class StateConflictError extends Error {
  readonly code = 'STATE_CONFLICT';

  constructor() {
    super('Certificate state conflict');
    this.name = 'StateConflictError';
  }
}
