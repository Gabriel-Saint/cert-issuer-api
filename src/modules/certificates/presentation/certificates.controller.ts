import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { readRequestId } from '../../../shared/presentation/request-id.middleware';
import { MachineAuthGuard } from '../../machine-auth/presentation/machine-auth.guard';
import type { MachineAuthenticatedRequest } from '../../machine-auth/presentation/machine-auth.guard';
import type { MachineIntegrationIdentity } from '../../machine-auth/presentation/machine-auth.guard';
import { RequireScopes } from '../../machine-auth/presentation/require-scopes.decorator';
import { RateLimit } from '../../rate-limit/presentation/rate-limit.decorator';
import { RateLimitGuard } from '../../rate-limit/presentation/rate-limit.guard';
import { DownloadCertificateUseCase } from '../application/use-cases/download-certificate.use-case';
import { GetCertificateByReferenceUseCase } from '../application/use-cases/get-certificate-by-reference.use-case';
import { GetCertificateUseCase } from '../application/use-cases/get-certificate.use-case';
import { IssueCertificateUseCase } from '../application/use-cases/issue-certificate.use-case';
import { ReissueCertificateUseCase } from '../application/use-cases/reissue-certificate.use-case';
import { RevokeCertificateUseCase } from '../application/use-cases/revoke-certificate.use-case';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import { ReissueCertificateDto } from './dto/reissue-certificate.dto';
import { RevokeCertificateDto } from './dto/revoke-certificate.dto';
import { toCertificateView } from './mappers/certificate-view.mapper';

@ApiTags('certificates')
@Controller('certificates')
@UseGuards(MachineAuthGuard, RateLimitGuard)
@RateLimit('private')
export class CertificatesController {
  constructor(
    private readonly issueCertificate: IssueCertificateUseCase,
    private readonly getCertificate: GetCertificateUseCase,
    private readonly getCertificateByReference: GetCertificateByReferenceUseCase,
    private readonly downloadCertificate: DownloadCertificateUseCase,
    private readonly revokeCertificate: RevokeCertificateUseCase,
    private readonly reissueCertificate: ReissueCertificateUseCase,
  ) {}

  @Post()
  @RequireScopes('issue')
  @RateLimit('private', 'mutation')
  @ApiOperation({ summary: 'Emite certificado de conclusão de curso' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Certificado emitido.' })
  @ApiAcceptedResponse({ description: 'Emissão ainda em processamento.' })
  async issue(
    @Req() request: MachineAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: IssueCertificateDto,
  ) {
    const integration = this.requireIntegration(request);
    const result = await this.issueCertificate.execute({
      integrationId: integration.id,
      institutionId: integration.institutionId,
      clientDbId: integration.clientDbId,
      clientId: integration.clientId,
      requestId: readRequestId(request),
      idempotencyKey,
      requestHash: this.requestHash(request),
      input: body,
    });
    response.status(
      result.status === 'PROCESSING' ? 202 : result.reused ? 200 : 201,
    );
    return result;
  }

  @Get('by-reference/:externalReference')
  @RequireScopes('read')
  @ApiOperation({
    summary:
      'Consulta o certificado vigente pela chave de identidade canônica SHA-256',
  })
  @ApiOkResponse({ description: 'Metadados autorizados do certificado.' })
  async findByReference(
    @Req() request: MachineAuthenticatedRequest,
    @Param('externalReference') externalReference: string,
  ) {
    const integration = this.requireIntegration(request);
    return toCertificateView(
      await this.getCertificateByReference.execute(
        integration.id,
        externalReference,
      ),
    );
  }

  @Get(':id')
  @RequireScopes('read')
  @ApiOperation({ summary: 'Consulta metadados autorizados de um certificado' })
  @ApiOkResponse({ description: 'Metadados autorizados do certificado.' })
  async findById(
    @Req() request: MachineAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const integration = this.requireIntegration(request);
    return toCertificateView(
      await this.getCertificate.execute(integration.id, id),
    );
  }

  @Get(':id/pdf')
  @RequireScopes('read')
  @ApiOperation({ summary: 'Autoriza URL pré-assinada curta do PDF privado' })
  @ApiOkResponse({ description: 'URL pré-assinada de curta duração.' })
  download(
    @Req() request: MachineAuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const integration = this.requireIntegration(request);
    return this.downloadCertificate.execute({
      integrationId: integration.id,
      certificateId: id,
      clientId: integration.clientId,
      requestId: readRequestId(request),
    });
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequireScopes('revoke')
  @RateLimit('private', 'mutation')
  @ApiOperation({ summary: 'Revoga um certificado vigente' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revoke(
    @Req() request: MachineAuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: RevokeCertificateDto,
  ) {
    const integration = this.requireIntegration(request);
    return this.revokeCertificate.execute({
      integrationId: integration.id,
      clientDbId: integration.clientDbId,
      clientId: integration.clientId,
      certificateId: id,
      idempotencyKey,
      requestHash: this.requestHash(request),
      actorId: body.actorId,
      reason: body.reason,
      requestId: readRequestId(request),
    });
  }

  @Post(':id/reissue')
  @RequireScopes('issue', 'revoke')
  @RateLimit('private', 'mutation')
  @ApiOperation({ summary: 'Reemite corretivamente um certificado vigente' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async reissue(
    @Req() request: MachineAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: ReissueCertificateDto,
  ) {
    const integration = this.requireIntegration(request);
    const result = await this.reissueCertificate.execute({
      integrationId: integration.id,
      institutionId: integration.institutionId,
      clientDbId: integration.clientDbId,
      clientId: integration.clientId,
      certificateId: id,
      idempotencyKey,
      requestHash: this.requestHash(request),
      requestId: readRequestId(request),
      input: body,
    });
    response.status(result.status === 'PROCESSING' ? 202 : 200);
    return result;
  }

  private requireIntegration(
    request: MachineAuthenticatedRequest,
  ): MachineIntegrationIdentity {
    if (!request.machineIntegration) {
      throw new ServiceUnavailableException({ code: 'RAW_BODY_UNAVAILABLE' });
    }
    return request.machineIntegration;
  }

  private requestHash(request: MachineAuthenticatedRequest): string {
    if (!request.rawBody) {
      throw new ServiceUnavailableException({ code: 'RAW_BODY_UNAVAILABLE' });
    }
    return IssueCertificateUseCase.hashRequest(request.rawBody);
  }
}
