/**
 * explorar.controller.ts — as rotas do Explorar.
 *
 * Prefixo próprio (`/explorar`) em vez de `/decks/publicos`: o `DecksController`
 * tem `GET /decks/:id` com `ParseUUIDPipe`, e "publicos" cairia nele como um id
 * inválido — 400 em vez da lista, dependendo da ordem de registro das rotas.
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CurtirDto, FiltrosDoExplorarDto, type FiltrosDoExplorar } from './explorar.dto.js';
import { ExplorarService } from './explorar.service.js';

@ApiTags('Explorar')
@ApiBearerAuth()
@Controller('explorar')
@UseGuards(JwtAuthGuard)
export class ExplorarController {
  constructor(private readonly explorar: ExplorarService) {}

  @Get('decks')
  @ApiOperation({ summary: 'Decks públicos, com filtros e paginação' })
  listar(
    @Request() req: RequisicaoAutenticada,
    @Query(new ZodValidationPipe(FiltrosDoExplorarDto)) filtros: FiltrosDoExplorar,
  ) {
    return this.explorar.listar(req.user.sub, filtros);
  }

  @Get('decks/:id')
  @ApiOperation({ summary: 'Um deck público, com as cartas hidratadas' })
  ver(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.explorar.ver(req.user.sub, id);
  }

  /**
   * Curtir é idempotente pelo corpo (`curtir: true|false`) e não por alternar:
   * dois cliques rápidos com "alternar" leriam o mesmo estado e se anulariam.
   */
  @Post('decks/:id/curtir')
  @Throttle({ curto: { limit: 10, ttl: 10_000 }, longo: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Curtir ou descurtir um deck público' })
  curtir(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CurtirDto)) dto: CurtirDto,
  ) {
    return this.explorar.curtir(req.user.sub, id, dto.curtir);
  }

  @Post('decks/:id/copiar')
  @Throttle({ curto: { limit: 3, ttl: 10_000 }, longo: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Copiar um deck público para os seus decks' })
  copiar(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.explorar.copiar(req.user.sub, id);
  }
}
