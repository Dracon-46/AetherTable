import { Controller, Post, Body, Param, UseGuards, Request, Get } from '@nestjs/common';
import { MatchesService } from './matches.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Post('create')
  createMatch(@Request() req: any) {
    return this.matchesService.createMatch(req.user.sub, req.user.username);
  }

  @Post(':roomCode/join')
  joinMatch(
    @Request() req: any, 
    @Param('roomCode') roomCode: string, 
    @Body('deckId') deckId: string
  ) {
    return this.matchesService.joinMatch(req.user.sub, req.user.username, roomCode, deckId);
  }

  @Get(':roomCode/voice-token')
  getVoiceToken(@Request() req: any, @Param('roomCode') roomCode: string) {
    return this.matchesService.getVoiceToken(req.user.sub, req.user.username, roomCode);
  }
}
