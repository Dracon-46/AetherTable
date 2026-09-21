/**
 * oauth.types.ts — o recorte do perfil do provedor que realmente usamos.
 *
 * As estratégias recebiam `profile: any` e liam `emails[0].value` sem checar
 * nada. Um perfil sem e-mail (conta Discord não verificada, escopo negado)
 * estourava `TypeError: Cannot read properties of undefined` dentro do
 * `validate` — o `catch` transformava isso num "falha de login" genérico e a
 * causa nunca aparecia.
 */

export interface PerfilOAuth {
  id: string;
  username?: string;
  emails?: Array<{ value?: string; verified?: boolean | string }>;
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
  /** O JSON cru do provedor. O Google só põe `email_verified` aqui. */
  _json?: { email_verified?: boolean | string };
}

/** Extrai o primeiro e-mail utilizável, ou `null`. */
export function primeiroEmail(perfil: PerfilOAuth): string | null {
  const bruto = perfil.emails?.find((e) => typeof e.value === 'string' && e.value.includes('@'));
  return bruto?.value?.toLowerCase() ?? null;
}

/**
 * O provedor CONFIRMA que o dono do e-mail é quem está entrando?
 *
 * ─── ISTO NÃO ERA PERGUNTADO, E ERA UM CAMINHO DE TOMADA DE CONTA ──────────
 *
 * `validateOAuthUser` vincula a identidade do provedor a uma conta local que
 * tenha o mesmo e-mail. Sem checar a verificação, a sequência abaixo entrega a
 * conta de qualquer jogador a qualquer pessoa:
 *
 *   1. a vítima tem conta no AetherTable com `vitima@exemplo.com`, senha própria;
 *   2. o atacante cria uma conta no provedor e declara esse mesmo endereço;
 *   3. o provedor entrega o perfil com o e-mail NÃO verificado;
 *   4. nós casamos por e-mail e o atacante entra na conta da vítima.
 *
 * O Google verifica sempre e manda `email_verified`. O Discord manda `verified`
 * e **permite conta com e-mail não confirmado** — é exatamente o passo 3.
 *
 * `true` só quando o provedor afirma a verificação. Ausência conta como NÃO
 * verificado: falha fechada, o mesmo critério de `schema/visibility.ts`.
 */
export function emailVerificadoPeloProvedor(perfil: PerfilOAuth): boolean {
  const doJson = perfil._json?.email_verified;
  const doEmail = perfil.emails?.find((e) => typeof e.value === 'string')?.verified;

  // Alguns provedores mandam a string `'true'` em vez do booleano.
  const afirmativo = (v: boolean | string | undefined) => v === true || v === 'true';

  return afirmativo(doJson) || afirmativo(doEmail);
}

/**
 * Username inicial derivado do e-mail. Precisa casar com o formato aceito no
 * cadastro (auth.dto.ts): letras, números, ponto, hífen e underline.
 */
export function usernameSugerido(email: string, perfil: PerfilOAuth): string {
  const base = (perfil.username ?? email.split('@')[0] ?? 'jogador')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `jogador${Date.now().toString().slice(-6)}`;
}
