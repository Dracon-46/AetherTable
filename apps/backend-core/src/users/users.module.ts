import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

/**
 * Módulo de Usuários (UsersModule).
 * Responsável pelas regras de domínio de perfis, preferências e 
 * isolamento do acesso à tabela User no banco de dados.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // Exportado para que o AuthModule possa utilizá-lo
})
export class UsersModule {}
