import { Controller, Post, Body, Param, UseGuards, Request, Get } from '@nestjs/common';
import { MatchesService } from './matches.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CriarPartidaDto, EntrarNaPartidaDto, RoomCodeParam } from './matches.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  /**
   * O corpo é OPCIONAL, e o `.default({})` do DTO é o que garante isso: até
   * esta fatia o painel chamava `POST /matches/create` sem corpo nenhum, e
   * introduzir configuração quebrando esse contrato seria trocar um problema
   * por outro. Sem corpo, a sala nasce em `CONFIG_DE_SALA_PADRAO`.
   */
  @Post('create')
  createMatch(
    @Request() req: RequisicaoAutenticada,
    @Body(new ZodValidationPipe(CriarPartidaDto)) dto: CriarPartidaDto,
  ) {
    return this.matchesService.createMatch(req.user.sub, req.user.username, dto);
  }

  @Post(':roomCode/join')
  joinMatch(
    @Request() req: RequisicaoAutenticada,
    @Param('roomCode', new ZodValidationPipe(RoomCodeParam)) roomCode: string,
    @Body(new ZodValidationPipe(EntrarNaPartidaDto)) dto: EntrarNaPartidaDto,
  ) {
    return this.matchesService.joinMatch(
      req.user.sub,
      req.user.username,
      roomCode,
      dto.deckId,
      dto.configToken,
    );
  }

  /**
   * Passe para ASSISTIR. Sem corpo: quem assiste não escolhe deck nem
   * configura mesa — ver `spectateMatch`.
   */
  @Post(':roomCode/spectate')
  spectateMatch(
    @Request() req: RequisicaoAutenticada,
    @Param('roomCode', new ZodValidationPipe(RoomCodeParam)) roomCode: string,
  ) {
    return this.matchesService.spectateMatch(req.user.sub, req.user.username, roomCode);
  }

  @Get(':roomCode/voice-token')
  getVoiceToken(
    @Request() req: RequisicaoAutenticada,
    @Param('roomCode', new ZodValidationPipe(RoomCodeParam)) roomCode: string,
  ) {
    return this.matchesService.getVoiceToken(req.user.sub, req.user.username, roomCode);
  }
}
