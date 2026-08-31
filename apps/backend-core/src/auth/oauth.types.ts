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
  emails?: Array<{ value?: string }>;
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
}

/** Extrai o primeiro e-mail utilizável, ou `null`. */
export function primeiroEmail(perfil: PerfilOAuth): string | null {
  const bruto = perfil.emails?.find((e) => typeof e.value === 'string' && e.value.includes('@'));
  return bruto?.value?.toLowerCase() ?? null;
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
