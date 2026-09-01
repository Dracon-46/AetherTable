/**
 * ttl.ts — a vida do access token, num lugar só e num formato só.
 *
 * POR QUE ISTO EXISTE
 *
 * O valor morava em três lugares que discordavam entre si:
 *
 *   auth.module.ts    assinava com `expiresIn: '7d'`
 *   auth.service.ts   devolvia `expiresIn: 900` no corpo da resposta
 *   render.yaml       definia `JWT_ACCESS_TTL=900`, que ninguém lia
 *
 * Ou seja: o token valia SETE DIAS e o cliente era informado de que valia
 * quinze minutos. Um cliente que confiasse nesse número renovaria a sessão sem
 * necessidade; um auditor que o lesse concluiria que a exposição era 300x menor
 * do que era de fato.
 *
 * ─── POR QUE SEGUNDOS, SEMPRE ──────────────────────────────────────────────
 *
 * O `jsonwebtoken` aceita `expiresIn` como número (segundos) ou como texto de
 * duração (`'12h'`). O que ele NÃO aceita é a string `'900'`: ela cai no parser
 * de duração, que não reconhece dígitos soltos, e lança "Invalid expiresIn
 * option". E `900` é exatamente o que o `render.yaml` define.
 *
 * Toda variável de ambiente chega como texto. Converter tudo para segundos
 * elimina a classe inteira de erro — e o número serve igual para assinar o
 * token e para informar o cliente, então não há dois formatos para divergir.
 */

/** Padrão: doze horas. Ver o comentário em auth.module.ts para o porquê. */
export const TTL_PADRAO_SEGUNDOS = 12 * 60 * 60;

/** `900` (segundos) ou `12h` / `45m` / `7d` / `30s`. */
const SO_DIGITOS = /^\d+$/;
const DURACAO = /^(\d+)\s*([smhd])$/i;

const FATOR = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/**
 * Vida do access token EM SEGUNDOS, a partir da variável de ambiente.
 *
 * Qualquer valor inválido — vazio, zero, negativo, formato desconhecido — cai
 * no padrão. Um TTL zero ou negativo produziria token nascido expirado, e o
 * sintoma seria "não autorizado" em toda requisição depois de um login que
 * pareceu dar certo.
 */
export function ttlEmSegundos(bruto: string | undefined): number {
  const valor = bruto?.trim();
  if (!valor) return TTL_PADRAO_SEGUNDOS;

  if (SO_DIGITOS.test(valor)) {
    const segundos = Number(valor);
    return segundos > 0 ? segundos : TTL_PADRAO_SEGUNDOS;
  }

  const match = DURACAO.exec(valor);
  if (!match) return TTL_PADRAO_SEGUNDOS;

  const quantidade = Number(match[1]);
  const unidade = match[2]!.toLowerCase() as keyof typeof FATOR;
  const segundos = quantidade * FATOR[unidade];
  return segundos > 0 ? segundos : TTL_PADRAO_SEGUNDOS;
}
