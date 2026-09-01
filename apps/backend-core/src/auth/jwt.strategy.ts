import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string; // ID do usuário
  username: string; // Username para evitar roundtrips no banco quando possível
}

/**
 * Estratégia do Passport para validar Tokens JWT.
 * O NestJS invocará essa classe automaticamente quando uma rota
 * estiver protegida pelo @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      // O token deve vir no cabeçalho HTTP: "Authorization: Bearer <token>"
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      // Rejeita automaticamente se o token passou da data de expiração
      ignoreExpiration: false,

      // Chave secreta super segura (gerada aleatoriamente no .env)
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  /**
   * Se o token foi decodificado e validado com sucesso, esse método é chamado.
   * O retorno dele é injetado no objeto "req.user" do Express.
   */
  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException();
    }
    // Retornamos apenas o essencial para reduzir overhead de memória
    return { sub: payload.sub, username: payload.username };
  }
}
