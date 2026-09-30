import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './infrastructure/persistence/prisma.service';

@ApiTags('health')
@Controller('health')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Verifica se a API está respondendo' })
  @ApiResponse({ status: 200, description: 'API disponível.' })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Verifica se a API está pronta para atender' })
  @ApiResponse({ status: 200, description: 'API e dependências disponíveis.' })
  @ApiResponse({ status: 503, description: 'Banco de dados indisponível.' })
  async getReadiness(): Promise<{ status: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
  }
}
