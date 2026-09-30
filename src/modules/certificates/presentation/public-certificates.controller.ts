import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RateLimit } from '../../rate-limit/presentation/rate-limit.decorator';
import { RateLimitGuard } from '../../rate-limit/presentation/rate-limit.guard';
import { FileCheckCertificateUseCase } from '../application/use-cases/file-check-certificate.use-case';
import { VerifyPublicCertificateUseCase } from '../application/use-cases/verify-public-certificate.use-case';
import { readPdfSha256 } from './pdf-upload.reader';

@ApiTags('public-verification')
@Controller('public/certificates')
@UseGuards(RateLimitGuard)
export class PublicCertificatesController {
  constructor(
    private readonly verifyCertificate: VerifyPublicCertificateUseCase,
    private readonly fileCheckCertificate: FileCheckCertificateUseCase,
  ) {}

  @Get(':code')
  @RateLimit('publicVerify')
  @ApiOperation({ summary: 'Verifica publicamente um certificado' })
  @ApiOkResponse({ description: 'Dados públicos mínimos do certificado.' })
  verify(@Param('code') code: string) {
    return this.verifyCertificate.execute(code);
  }

  @Post(':code/file-check')
  @HttpCode(200)
  @RateLimit('fileCheck')
  @ApiConsumes('application/pdf')
  @ApiOperation({
    summary: 'Compara o SHA-256 de um PDF enviado sem persistir o upload',
  })
  @ApiOkResponse({ description: 'Resultado da comparação de hash.' })
  async fileCheck(@Req() request: Request, @Param('code') code: string) {
    const sha256 = await readPdfSha256(request);
    return this.fileCheckCertificate.execute(code, sha256);
  }
}
