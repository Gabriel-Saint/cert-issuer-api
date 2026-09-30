import { Global, Module } from '@nestjs/common';
import { HmacCanonicalizer } from './application/hmac-canonicalizer';
import { SecretProtector } from './infrastructure/secret-protector';
import { MachineAuthGuard } from './presentation/machine-auth.guard';

@Global()
@Module({
  providers: [HmacCanonicalizer, MachineAuthGuard, SecretProtector],
  exports: [HmacCanonicalizer, MachineAuthGuard, SecretProtector],
})
export class MachineAuthModule {}
