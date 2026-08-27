import { Controller, Post, Body, HttpCode, HttpStatus, Get, UseGuards, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

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

  // --- OAuth Google ---
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Google' })
  async googleAuth(@Req() req: any) {
    // Inicia o redirecionamento para o Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Google' })
  googleAuthRedirect(@Req() req: any, @Res() res: any) {
    // req.user contém o usuário validado pela strategy
    const payload = { username: req.user.username, sub: req.user.id };
    const accessToken = this.authService['jwtService'].sign(payload); // Hack rápido para obter o jwtService ou pode injetar no construtor
    
    // Redireciona para o frontend com o token
    return res.redirect(`http://localhost:3000/dashboard?token=${accessToken}`);
  }

  // --- OAuth Discord ---
  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  @ApiOperation({ summary: 'Inicia o fluxo OAuth com Discord' })
  async discordAuth(@Req() req: any) {
    // Inicia o redirecionamento para o Discord
  }

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  @ApiOperation({ summary: 'Callback do fluxo OAuth Discord' })
  discordAuthRedirect(@Req() req: any, @Res() res: any) {
    const payload = { username: req.user.username, sub: req.user.id };
    const accessToken = this.authService['jwtService'].sign(payload);
    
    return res.redirect(`http://localhost:3000/dashboard?token=${accessToken}`);
  }
}
