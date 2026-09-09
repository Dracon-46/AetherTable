import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RevogacaoService } from './revogacao.service.js';

export interface JwtPayload {
  sub: string; // ID do usuário
  username: string; // Username para evitar roundtrips no banco quando possível
  /**
   * Identificador do token, para a denylist do logout.
   *
   * OPCIONAL no tipo porque tokens emitidos ANTES desta mudança não o têm — e
   * eles continuam válidos até expirar. Um token sem `jti` não é revogável, o
   * que é o comportamento antigo; em 24 horas (o TTL do access token) não
   * existe mais nenhum.
   */
  jti?: string;
  /** Expiracao em segundos (padrao JWT). */
  exp: number;
}

/**
 * Estratégia do Passport para validar Tokens JWT.
 * O NestJS invocará essa classe automaticamente quando uma rota
 * estiver protegida pelo @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private readonly revogacao: RevogacaoService,
  ) {
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

    /**
     * ─── O LOGOUT PRECISA VALER AQUI ─────────────────────────────────────
     *
     * Sem esta checagem, `POST /auth/logout` grava a revogação e nada a lê: o
     * token continua sendo aceito em toda rota até expirar sozinho, 24 horas
     * depois. É o que tornava o logout um gesto puramente cosmético.
     *
     * Custa uma leitura por chave primária numa tabela que guarda só tokens
     * revogados ainda vivos — ver `revogacao.service.ts` para por que não é
     * cache em memória.
     */
    if (payload.jti && (await this.revogacao.estaRevogado(payload.jti))) {
      throw new UnauthorizedException('Sessão encerrada. Entre de novo.');
    }

    // `jti` e `exp` vao junto porque o logout precisa dos dois para gravar a
    // revogacao com a validade certa — e `req.user` e o unico lugar onde o
    // controller alcanca o payload decodificado.
    return {
      sub: payload.sub,
      username: payload.username,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
