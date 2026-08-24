import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Realiza o login e devolve os tokens JWT' })
  login(@Body() signInDto: Record<string, any>) {
    // Para um projeto produtivo, validaremos o signInDto com Zod aqui (DTO)
    return this.authService.login(signInDto.email, signInDto.password);
  }

  @Post('register')
  @ApiOperation({ summary: 'Cadastra um novo usuário no sistema' })
  register(@Body() signUpDto: Record<string, any>) {
    // Novamente, um DTO rigoroso entraria aqui
    return this.authService.register(signUpDto.email, signUpDto.username, signUpDto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga tokens de acesso (Invalidar sessão)' })
  logout() {
    // Lógica para limpar cookies no Express Response
    return;
  }
}
