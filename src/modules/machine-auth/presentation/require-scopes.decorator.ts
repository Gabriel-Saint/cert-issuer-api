import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPES_METADATA = 'required_scopes';

export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRED_SCOPES_METADATA, scopes);
