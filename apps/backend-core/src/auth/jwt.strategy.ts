import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { RevogacaoService } from './revogacao.service.js';
import { naoEhSessaoDaApi } from './passe-de-mesa.js';

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
  /** Emissao em segundos (padrao JWT). Comparada com o corte de sessao. */
  iat?: number;
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
     * ─── PASSE DE MESA NÃO É SESSÃO ──────────────────────────────────────
     *
     * O seat token e o passe de espectador são assinados com o mesmo segredo e
     * carregam `sub`. Sem esta recusa, o link `/play/CODE?token=...` colado no
     * grupo dava a quem o abrisse acesso à API inteira como o dono do link —
     * apagar decks, trocar o perfil, entrar em outras mesas em nome dele. Ver
     * `passe-de-mesa.ts`.
     */
    if (naoEhSessaoDaApi(payload)) {
      throw new UnauthorizedException('Este token não é uma sessão da API.');
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

    /**
     * ─── CORTE DE SESSÃO: TROCAR A SENHA DERRUBA TUDO ─────────────────────
     *
     * A denylist acima revoga UM token, e serve ao logout — ali se sabe qual
     * encerrar. Trocar de senha precisa derrubar TODAS as sessões, e ninguém
     * conhece os `jti` que estão por aí.
     *
     * Sem esta comparação, redefinir a senha de uma conta invadida não expulsa
     * o invasor: ele segue dentro com o token que já tinha, por até 24 horas.
     * A troca de senha viraria teatro — e é justamente no momento de urgência
     * que ela precisa funcionar.
     *
     * `iat` vem em SEGUNDOS (padrão JWT) e a coluna é timestamp. O segundo de
     * folga cobre o arredondamento: um token emitido no mesmo segundo do corte
     * é do próprio login que acabou de acontecer, e derrubá-lo faria a pessoa
     * não conseguir entrar depois de trocar a senha.
     */
    const conta = await this.revogacao.estadoDaConta(payload.sub);

    /**
     * ─── BANIDO OU SUSPENSO NÃO SEGUE COM O TOKEN QUE JÁ TINHA ────────────
     *
     * A suspensão e o banimento só eram conferidos no LOGIN. Quem já estava
     * com um token na mão continuava jogando, criando mesas e editando decks
     * até ele expirar — a punição valia a partir do dia seguinte. O corte de
     * sessão gravado por `suspender`/`banir` cobre os tokens antigos; esta
     * leitura cobre o resto (um token emitido no mesmo segundo do corte passa
     * pela folga acima) e já vem na mesma consulta, sem custo extra.
     *
     * Conta inexistente também cai: depois do expurgo definitivo, um token
     * órfão seguia aceito e cada rota falhava de um jeito diferente.
     */
    if (!conta || conta.deletedAt) {
      throw new UnauthorizedException('Esta conta foi encerrada.');
    }
    if (conta.suspendedUntil && conta.suspendedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Sua conta está suspensa.');
    }

    if (payload.iat) {
      const corte = conta.tokensValidosApos;
      if (corte && payload.iat * 1000 < corte.getTime() - 1000) {
        // A mensagem falava só de senha, mas o corte também é gravado pela
        // moderação e pela redefinição — "senha alterada" confundia quem foi
        // deslogado por outro motivo.
        throw new UnauthorizedException('Sua sessão foi encerrada. Entre de novo.');
      }
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
