/**
 * http.types.ts — o formato de `req.user` depois do Passport.
 *
 * Os controllers declaravam `@Request() req: any` em toda rota protegida. Além
 * de desligar o type-checker exatamente no ponto em que se decide DE QUEM é a
 * requisição, isso escondia a divergência real entre as estratégias:
 * `JwtStrategy.validate` devolve `{ sub, username }`, enquanto as estratégias de
 * OAuth devolvem o registro do banco, com `id`. Ler `req.user.sub` num callback
 * de OAuth dava `undefined` em silêncio.
 */

/** Usuário autenticado por JWT — ver `JwtStrategy.validate`. */
export interface UsuarioJwt {
  /** Id persistente da conta. */
  sub: string;
  username: string;
  /**
   * Identificador do token. AUSENTE em tokens emitidos antes da denylist do
   * logout existir — eles continuam válidos, e simplesmente não são
   * revogáveis, até expirar.
   */
  jti?: string;
  /** Expiração do token, em SEGUNDOS (padrão JWT). O logout a copia para a
   *  denylist: a linha vale só enquanto o token valeria. */
  exp: number;
}

/** Usuário recém-validado por uma estratégia OAuth (registro do banco). */
export interface UsuarioOAuth {
  id: string;
  username: string;
  email: string;
}

export interface RequisicaoAutenticada {
  user: UsuarioJwt;
}

export interface RequisicaoOAuth {
  user: UsuarioOAuth;
}

/** O mínimo de `express.Response` que os callbacks de OAuth usam. */
export interface RespostaRedirecionavel {
  redirect(url: string): void;
}
