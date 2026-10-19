import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificacoesService } from './notificacoes.service.js';
import { MarcarLeituraDto } from './notificacoes.dto.js';

@ApiTags('Notificações')
@ApiBearerAuth()
@Controller('notificacoes')
@UseGuards(JwtAuthGuard)
export class NotificacoesController {
  constructor(private readonly notificacoes: NotificacoesService) {}

  @Get()
  @ApiOperation({
    summary: 'Avisos dos últimos 30 dias: curtidas nos decks e denúncias analisadas',
  })
  listar(@Request() req: RequisicaoAutenticada) {
    return this.notificacoes.listar(req.user.sub);
  }

  @Get('leitura')
  @ApiOperation({ summary: 'Quando o sino foi aberto pela última vez e a última Novidade lida' })
  leitura(@Request() req: RequisicaoAutenticada) {
    return this.notificacoes.leitura(req.user.sub);
  }

  @Put('leitura')
  @ApiOperation({ summary: 'Marca o sino como lido; a data só avança' })
  marcarLeitura(
    @Request() req: RequisicaoAutenticada,
    @Body(new ZodValidationPipe(MarcarLeituraDto)) body: MarcarLeituraDto,
  ) {
    return this.notificacoes.marcarLeitura(req.user.sub, body);
  }
}
