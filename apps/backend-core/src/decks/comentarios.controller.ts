/**
 * comentarios.controller.ts — os comentários de um deck público.
 *
 * Debaixo de `/explorar/decks/:id`, ao lado de curtir e copiar: comentar é
 * mais uma coisa que se faz com um deck que outra pessoa publicou.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ComentarDto } from './explorar.dto.js';
import { ComentariosService } from './comentarios.service.js';

@ApiTags('Explorar')
@ApiBearerAuth()
@Controller('explorar/decks/:id/comentarios')
@UseGuards(JwtAuthGuard)
export class ComentariosController {
  constructor(private readonly comentarios: ComentariosService) {}

  @Get()
  @ApiOperation({ summary: 'Os comentários de um deck público, do mais antigo ao mais novo' })
  listar(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.comentarios.listar(req.user.sub, id);
  }

  /** Apertado de propósito: comentário é texto público, e é onde o spam mora. */
  @Post()
  @Throttle({ curto: { limit: 3, ttl: 30_000 }, longo: { limit: 30, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Comentar num deck público' })
  comentar(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ComentarDto)) dto: ComentarDto,
  ) {
    return this.comentarios.comentar(req.user.sub, id, dto.texto);
  }

  @Delete(':comentarioId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Apagar um comentário (o autor ou o dono do deck)' })
  apagar(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('comentarioId', ParseUUIDPipe) comentarioId: string,
  ) {
    return this.comentarios.apagar(req.user.sub, id, comentarioId);
  }
}
