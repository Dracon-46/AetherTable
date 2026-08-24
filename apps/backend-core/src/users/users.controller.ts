import { Controller, Get, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service.js';

// NOTA: JwtAuthGuard será implementado no AuthModule. Por enquanto, criaremos
// as rotas e depois injetaremos o Guard.
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

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
  async getMe(@Request() req: any) {
    // O JwtAuthGuard extrai o ID do token e coloca em req.user.sub
    return this.usersService.findById(req.user.sub);
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
