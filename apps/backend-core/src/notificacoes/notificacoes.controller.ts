import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { NotificacoesService } from './notificacoes.service.js';

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
}
