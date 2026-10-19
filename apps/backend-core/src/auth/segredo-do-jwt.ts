/**
 * segredo-do-jwt.ts — o segredo e o algoritmo de TODO token desta API.
 *
 * ─── O ALGORITMO É FIXO, NA ASSINATURA E NA CONFERÊNCIA ─────────────────────
 *
 * Nenhum `verify` dizia quais algoritmos aceitava, e o `jsonwebtoken` então
 * aceita o que o cabeçalho do token declarar dentro da família da chave. Com
 * segredo compartilhado isso ainda não abre a porta sozinho, mas deixa a
 * decisão com quem fabrica o token — e é a classe de defeito que já virou
 * `alg: none` e confusão de chave em outras bibliotecas. Todo token daqui é
 * HS256; qualquer outro é recusado sem conversa.
 *
 * ─── SEGREDO CURTO NÃO SOBE EM PRODUÇÃO ─────────────────────────────────────
 *
 * HS256 com um segredo de dez caracteres cai por força bruta offline: basta
 * UM token capturado — e o passe da mesa viaja numa URL que se cola no grupo.
 * Com o segredo, qualquer um assina sessão de qualquer conta, administradores
 * incluídos. 32 caracteres é o piso (256 bits, se aleatórios, como
 * `openssl rand -base64 48` produz). Em produção o boot FALHA: um deploy que
 * não sobe aparece na hora; um segredo fraco não aparece nunca.
 */

export const ALGORITMO_DO_JWT = 'HS256' as const;

/** Para `verify(token, { algorithms: ALGORITMOS_ACEITOS })`. */
export const ALGORITMOS_ACEITOS: ['HS256'] = [ALGORITMO_DO_JWT];

export const TAMANHO_MINIMO_DO_SEGREDO = 32;

/** O mínimo de `ConfigService` que esta função usa — testável sem Nest. */
interface LeitorDeConfig {
  get<T = string>(chave: string): T | undefined;
}

/**
 * Lê `JWT_SECRET`. Em produção, ausente ou curto derruba o boot com a causa
 * escrita; fora dela, segue como antes — a máquina de quem desenvolve não
 * precisa de um segredo de verdade.
 */
export function segredoDoJwt(config: LeitorDeConfig): string {
  const segredo = config.get<string>('JWT_SECRET') ?? '';
  const producao = config.get<string>('NODE_ENV') === 'production';

  if (producao && segredo.length < TAMANHO_MINIMO_DO_SEGREDO) {
    throw new Error(
      `JWT_SECRET precisa de pelo menos ${TAMANHO_MINIMO_DO_SEGREDO} caracteres em produção ` +
        `(tem ${segredo.length}). Gere um com \`openssl rand -base64 48\`.`,
    );
  }

  return segredo;
}
