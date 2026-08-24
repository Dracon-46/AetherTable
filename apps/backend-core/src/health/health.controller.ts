import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * Controller de saúde da API. Usado por orquestradores (Kubernetes, Render)
 * para monitorar liveness e readiness da aplicação.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealthIndicator: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Verifica o status da API e conexões com o banco.' })
  check() {
    return this.health.check([
      // Realiza um ping no banco de dados via Prisma para garantir conectividade
      () => this.prismaHealthIndicator.pingCheck('database', this.prismaService),
    ]);
  }
}
