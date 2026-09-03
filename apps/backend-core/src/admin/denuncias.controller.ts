import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { AdminDenunciasService } from './admin-denuncias.service.js';
import { AdminSistemaService } from './admin-sistema.service.js';
import { CriarDenunciaDto } from './admin.dto.js';

/**
 * denuncias.controller.ts — o lado do JOGADOR (DOC-061 §4).
 *
 * ─── POR QUE FICA NO MÓDULO ADMIN ──────────────────────────────────────────
 *
 * A rota é de jogador, o serviço é de moderação. Separar em dois módulos
 * duplicaria a lógica de deduplicação e de captura de evidência, e essas duas
 * regras têm de ser as MESMAS nos dois lados: se o jogador pudesse criar uma
 * denúncia por um caminho que a fila não conhece, a fila mostraria metade dos
 * casos. Um módulo, dois controllers, um serviço.
 *
 * ─── E POR QUE `GET /flags` ESTÁ AQUI ──────────────────────────────────────
 *
 * O cliente precisa saber se a voz está desligada (o kill switch de §5) ANTES
 * de tentar conectar no LiveKit — senão o jogador vê "conectando…" para sempre
 * e conclui que o microfone dele quebrou. É uma leitura de configuração
 * pública, sem dado de ninguém, e não pode exigir papel administrativo.
 */

@ApiTags('Moderação')
@Controller()
export class DenunciasController {
  constructor(
    private readonly denuncias: AdminDenunciasService,
    private readonly sistema: AdminSistemaService,
  ) {}

  /**
   * Denunciar um jogador.
   *
   * ─── O LIMITE É ESTREITO DE PROPÓSITO ────────────────────────────────────
   *
   * Cinco por minuto. Denúncia é um ato deliberado sobre uma pessoa, e um
   * limite folgado transformaria a rota na própria ferramenta de assédio que
   * ela existe para combater — bastaria um script denunciando todo mundo da
   * mesa para encher a fila do moderador com casos falsos.
   */
  @Post('reports')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ curto: { limit: 2, ttl: 10_000 }, longo: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Denuncia um jogador, com as últimas linhas do log como evidência' })
  criar(
    @Request() req: RequisicaoAutenticada,
    @Body(new ZodValidationPipe(CriarDenunciaDto)) dto: CriarDenunciaDto,
  ) {
    return this.denuncias.criar(req.user.sub, dto);
  }

  /** Interruptores globais, para o cliente saber o que está desligado. */
  @Get('flags')
  @Throttle({ curto: { limit: 20, ttl: 5_000 }, longo: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Interruptores globais de plataforma (leitura pública)' })
  flags() {
    return this.sistema.listarFlags();
  }
}
