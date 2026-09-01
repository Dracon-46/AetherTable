import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * Controller de saúde da API. Usado por orquestradores (Kubernetes, Render)
 * para monitorar liveness e readiness da aplicação.
 */
/**
 * O health check NÃO passa pelo rate limit.
 *
 * O Render bate aqui a cada ~5 s, para sempre. Sob o limite global (10 req/5 s)
 * ele divide o balde com qualquer outro tráfego que venha do mesmo IP — e um
 * 429 numa sondagem de saúde não é um pedido recusado: é o orquestrador
 * concluindo que o serviço morreu. Ele reinicia o container, o novo container
 * toma 429 de novo, e o serviço entra em loop de restart por causa da própria
 * proteção.
 *
 * A rota é segura de expor: devolve status e ping no banco, sem dado de
 * usuário nem detalhe de infraestrutura.
 */
@SkipThrottle({ curto: true, longo: true })
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
