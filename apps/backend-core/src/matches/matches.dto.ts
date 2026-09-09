import { z } from 'zod';
import {
  IDIOMAS_DE_MESA,
  LIMITES_DE_SALA,
  MODOS_DE_COMUNICACAO,
  REALTIME_LIMITS,
  VISIBILIDADES,
  ehNomeDeSala,
  formatoExiste,
} from '@aethertable/shared-types';

const { NOME_MIN, NOME_MAX } = LIMITES_DE_SALA;

/**
 * matches.dto.ts — validação de borda das rotas de partida.
 *
 * `join` recebia `@Param('roomCode') roomCode: string` e
 * `@Body('deckId') deckId: string`, ambos sem conferência.
 *
 * O `deckId` é o mais direto: a coluna é `@db.Uuid` e o valor ia cru para
 * `prisma.deck.findFirst`. Um id fora do formato faz o Postgres recusar a
 * consulta, e a rota responde 500 em vez de 404 — trocando "não achei seu
 * deck" por "o banco quebrou", que é ao mesmo tempo pior para o jogador e mais
 * informativo para quem está sondando.
 *
 * O `roomCode` é gerado como `randomBytes(3).toString('hex').toUpperCase()`:
 * exatamente seis caracteres hexadecimais. Aceitar qualquer string ali deixava
 * a rota ser usada como sonda — cada tentativa cobrava uma consulta ao banco e
 * uma ida à Scryfall antes de descobrir que a sala não existe.
 */

/** Seis hexadecimais. Aceita minúscula e normaliza — o jogador digita o código. */
export const RoomCodeParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-F]{6}$/, 'Código de sala inválido');

/**
 * `deckId` é OPCIONAL: o grimório passou a ser escolhido dentro da sala de
 * espera (`INTENT_SET_DECK`). Continua sendo aceito aqui — quem já sabe com que
 * deck vai jogar não deve ser obrigado a escolher duas vezes — e continua sendo
 * validado como uuid quando vem, porque a coluna é `@db.Uuid` e um valor fora
 * do formato faz o Postgres recusar a consulta: a rota responderia 500 em vez
 * de 404.
 */
export const EntrarNaPartidaDto = z.object({
  deckId: z.string().uuid('deckId precisa ser um UUID').optional(),
  /**
   * Passe de CONFIGURAÇÃO, devolvido por `POST /matches/create`.
   *
   * Só o criador tem um, e ele vale só para o `roomCode` que o gerou. Quem
   * entra pelo código não manda nada aqui — a configuração dessa sala já
   * está no `RoomState` e é de lá que o lobby a lê.
   */
  configToken: z.string().max(4096).optional(),
});
export type EntrarNaPartidaDto = z.infer<typeof EntrarNaPartidaDto>;

/**
 * ─── CRIAR SALA: O CAMPO PERIGOSO É O `nome` ───────────────────────────────
 *
 * Dos sete campos, seis são enums fechados ou um inteiro com faixa — o Zod os
 * recusa por construção e não há muito o que dizer sobre eles. O `nome` é
 * outra história, e é o mesmo raciocínio que já governa o `username`:
 *
 *   1. ELE APARECE PARA ESTRANHOS. Sala pública entra em `GET /salas`, e o
 *      nome é o que o navegador de salas desenha. Sem regra, ele aceita dez
 *      mil letras e destrói o cartão da lista para todo mundo.
 *   2. ELE ATRAVESSA O LOG E O CHAT. Um caractere de controle no meio quebra
 *      a linha do painel; um `\u200b` produz um nome que parece vazio na tela
 *      mas passa em qualquer teste de comprimento.
 *
 * A validação NÃO é reescrita aqui: `ehNomeDeSala` mora em `shared-types` e é
 * a mesma função que o formulário do navegador chama antes de enviar e que o
 * `onCreate` do game-server chama ao gravar no estado. Três cópias da regra de
 * nome divergiriam na primeira mudança, e a divergência apareceria como um
 * nome que a tela aceita e a API recusa.
 *
 * Tudo é opcional de propósito: `createMatch` sem corpo continua funcionando e
 * cai em `CONFIG_DE_SALA_PADRAO`. Quebrar quem já chama a rota sem corpo para
 * introduzir configuração seria trocar um problema por outro.
 */
export const CriarPartidaDto = z
  .object({
    nome: z
      .string()
      .refine(ehNomeDeSala, `O nome precisa ter de ${NOME_MIN} a ${NOME_MAX} caracteres visíveis.`)
      .optional(),
    // Validado contra o CATÁLOGO, não contra uma lista escrita aqui: era assim
    // que "PAUPER" em maiúsculas passava na criação e falhava na validação de
    // deck, que conhece os ids em minúsculas.
    gameType: z.string().max(64).refine(formatoExiste, 'Formato desconhecido.').optional(),
    visibilidade: z.enum(VISIBILIDADES).optional(),
    comunicacao: z.enum(MODOS_DE_COMUNICACAO).optional(),
    idioma: z.enum(IDIOMAS_DE_MESA).optional(),
    /**
     * A faixa do FORMATO é aplicada depois, por `normalizarConfigDeSala`. Aqui
     * fica só o teto absoluto do sistema — o preset é quem sabe que Duel
     * Commander são exatamente dois, e essa regra não se duplica.
     */
    maxClients: z.number().int().min(1).max(REALTIME_LIMITS.MAX_PLAYERS).optional(),
    /** `null` = não declarado. Nunca calculado — é etiqueta do anfitrião. */
    nivelDePoder: z.number().int().min(1).max(5).nullable().optional(),
  })
  // Sem isto, `POST /matches/create` com corpo vazio (que é como o painel
  // chamava até agora) chega como `undefined` e o pipe recusa com 400.
  .default({});
export type CriarPartidaDto = z.infer<typeof CriarPartidaDto>;
