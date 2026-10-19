/**
 * desafios.ts — o progresso dos desafios (os minigames), por conta.
 *
 * ─── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * O recorde de cada desafio vivia no `localStorage` e a sequência em curso
 * vivia num `useState`: trocar de PC zerava o recorde, e um F5 zerava a
 * sequência. Agora os dois moram em `progresso_de_desafios`, uma linha por
 * conta e desafio.
 *
 * ─── UMA TABELA, E NÃO MAIS UM JSONB ───────────────────────────────────────
 *
 * As preferências vão para JSONB porque são substituídas inteiras e nunca
 * disputam escrita. O progresso é o contrário: muda a CADA PERGUNTA, e o
 * recorde tem uma regra que precisa valer no banco — só sobe. Com uma linha
 * por desafio, "só sobe" é um `UPDATE … WHERE recorde < :novo`, atômico; num
 * JSONB seria ler, comparar e regravar o objeto inteiro, e duas abas
 * respondendo ao mesmo tempo perderiam um recorde.
 */

/**
 * A chave de um desafio: `adivinhe`, `escada`, `grade`, `mais-jogada`… Texto
 * curto e fechado em minúsculas, número e hífen, porque vira chave primária e
 * segmento de URL.
 */
export const PADRAO_DA_CHAVE_DE_DESAFIO = /^[a-z0-9-]{1,40}$/;

/**
 * Quantos desafios uma conta pode ter. Há cinco hoje; o teto existe para a
 * tabela não virar depósito de chaves inventadas por um script — a 65ª chave
 * NOVA é recusada, e as que já existem continuam aceitando progresso.
 */
export const MAX_DESAFIOS_POR_CONTA = 64;

/** O maior placar aceito. Ninguém acerta cem mil seguidas; acima disso é forjado. */
export const MAX_PLACAR_DE_DESAFIO = 100_000;

export interface ProgressoDeDesafio {
  /** O melhor placar já feito. Só sobe — ver `DesafiosService`. */
  recorde: number;
  /** O placar em curso. */
  sequencia: number;
  /**
   * Há uma pergunta aberta, sorteada e ainda sem resposta.
   *
   * É o que impede pular pergunta difícil recarregando a página: ao abrir o
   * desafio com `emJogo: true`, a pergunta foi abandonada e a sequência zera.
   */
  emJogo: boolean;
}

/** `GET /users/me/desafios`: um registro por desafio que a conta já jogou. */
export type ProgressoDosDesafios = Record<string, ProgressoDeDesafio>;

export function ehChaveDeDesafio(valor: unknown): valor is string {
  return typeof valor === 'string' && PADRAO_DA_CHAVE_DE_DESAFIO.test(valor);
}

/** Um placar inteiro entre 0 e o teto; qualquer outra coisa é 0. */
export function normalizarPlacar(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return 0;
  return Math.min(MAX_PLACAR_DE_DESAFIO, Math.floor(valor));
}

/**
 * O mapa que veio da API (ou de uma versão dela que ainda não existia) vira
 * um mapa limpo: chave fora do formato some, número estranho vira 0, e
 * `emJogo` só é verdadeiro se for `true` mesmo. **Nunca falha** — um desafio
 * é passatempo, e um campo esquisito não pode impedir ninguém de jogar.
 */
export function normalizarProgressoDosDesafios(entrada: unknown): ProgressoDosDesafios {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return {};
  const saida: ProgressoDosDesafios = {};
  for (const [chave, valor] of Object.entries(entrada)) {
    if (!ehChaveDeDesafio(chave) || !valor || typeof valor !== 'object') continue;
    const p = valor as Record<string, unknown>;
    saida[chave] = {
      recorde: normalizarPlacar(p.recorde),
      sequencia: normalizarPlacar(p.sequencia),
      emJogo: p.emJogo === true,
    };
  }
  return saida;
}
