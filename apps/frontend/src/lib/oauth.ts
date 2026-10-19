/**
 * oauth.ts — a marca de "este navegador começou um login por provedor".
 *
 * ─── UM `#token=` QUALQUER ABRIA SESSÃO ─────────────────────────────────────
 *
 * O backend conclui o OAuth em `/dashboard#token=<jwt>`, e a captura aceitava
 * qualquer JWT válido que chegasse assim. Um atacante mandava o link com o
 * token DELE, e a vítima passava a usar a conta do atacante sem perceber — o
 * deck que ela montasse, as mensagens que escrevesse, tudo ia para lá. É o
 * login CSRF que o `state` do OAuth fecha no backend, reaberto no último passo.
 *
 * A marca fecha de novo: só quem clicou em "Entrar com…" NESTA aba, há pouco
 * tempo, aceita um token no retorno. O `sessionStorage` é por aba e por
 * origem — um link aberto de fora chega sem ela.
 */

const CHAVE = 'aethertable:oauth-iniciado';

/** O tempo de passar pelo provedor, com folga para digitar senha e 2FA. */
const VALIDADE_MS = 10 * 60_000;

export function marcarInicioDeOAuth(agora = Date.now()): void {
  try {
    sessionStorage.setItem(CHAVE, String(agora));
  } catch {
    /* sem storage o retorno será recusado: entrar por e-mail continua valendo */
  }
}

/**
 * A marca existe e é recente? Lê E APAGA: uma marca vale para um retorno só,
 * e um segundo `#token=` na mesma aba volta a ser suspeito.
 */
export function consumirMarcaDeOAuth(agora = Date.now()): boolean {
  let bruto: string | null = null;
  try {
    bruto = sessionStorage.getItem(CHAVE);
    sessionStorage.removeItem(CHAVE);
  } catch {
    return false;
  }
  if (!bruto) return false;
  const idade = agora - Number(bruto);
  return Number.isFinite(idade) && idade >= 0 && idade < VALIDADE_MS;
}

/** Marca o início e segue para o provedor. */
export function iniciarOAuth(urlDoProvedor: string): void {
  marcarInicioDeOAuth();
  window.location.href = urlDoProvedor;
}
