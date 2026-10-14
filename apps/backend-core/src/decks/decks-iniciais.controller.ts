/**
 * decks-iniciais.controller.ts — a vitrine dos decks prontos e o "usar".
 *
 * Prefixo próprio pelo mesmo motivo do Explorar: `/decks/iniciais` cairia no
 * `GET /decks/:id` com `ParseUUIDPipe` e responderia 400.
 */

import { Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { DecksIniciaisService } from './decks-iniciais.service.js';

@ApiTags('Decks iniciais')
@ApiBearerAuth()
@Controller('decks-iniciais')
@UseGuards(JwtAuthGuard)
export class DecksIniciaisController {
  constructor(private readonly iniciais: DecksIniciaisService) {}

  @Get()
  @ApiOperation({ summary: 'Os decks pré-montados oficiais oferecidos a quem começa' })
  listar() {
    return this.iniciais.listar();
  }

  /** Cria (ou reencontra) a cópia do deck inicial na conta de quem pediu. */
  @Post(':codigo/usar')
  @Throttle({ curto: { limit: 3, ttl: 10_000 }, longo: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Copia um deck inicial para os seus decks' })
  usar(@Request() req: RequisicaoAutenticada, @Param('codigo') codigo: string) {
    return this.iniciais.usar(req.user.sub, codigo.slice(0, 80));
  }
}
