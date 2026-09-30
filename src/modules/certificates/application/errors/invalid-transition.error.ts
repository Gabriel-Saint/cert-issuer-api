export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';

  constructor() {
    super('Invalid certificate transition');
    this.name = 'InvalidTransitionError';
  }
}
