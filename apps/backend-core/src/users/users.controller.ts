import { Controller, Get, Param, Request, UseGuards, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import type { UsersService } from './users.service.js';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Rota protegida. Retorna os dados do próprio usuário autenticado.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtém o perfil do usuário atualmente autenticado' })
  async getMe(@Request() req: RequisicaoAutenticada) {
    // O JwtAuthGuard extrai o ID do token e coloca em req.user.sub
    return this.usersService.findById(req.user.sub);
  }

  /**
   * Rota protegida. Atualiza o perfil e preferências do usuário.
   */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualiza o perfil do usuário' })
  async updateMe(
    @Request() req: RequisicaoAutenticada,
    @Body() body: { username?: string; displayName?: string; language?: string },
  ) {
    return this.usersService.updateUser(req.user.sub, body);
  }

  /**
   * Rota pública. Retorna o perfil público de um usuário (sem dados sensíveis).
   */
  @Get(':username')
  @ApiOperation({ summary: 'Obtém o perfil público de um jogador' })
  @ApiParam({ name: 'username', example: 'planeswalker42' })
  async getPublicProfile(@Param('username') username: string) {
    return this.usersService.findByUsername(username);
  }
}
