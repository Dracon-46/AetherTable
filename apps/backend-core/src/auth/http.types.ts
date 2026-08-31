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
