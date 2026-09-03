import { BadRequestException, Logger } from '@nestjs/common';
import {
  avaliarLegalidade,
  contarCartas as contarCartasCompartilhado,
  type CartaValidavel,
  type DeckValidavel as DeckValidavelCompartilhado,
} from '@aethertable/shared-types';

/**
 * formato.ts — a ponte entre a validação compartilhada e o HTTP.
 *
 * ─── O QUE ESTE ARQUIVO ERA, E POR QUE ENCOLHEU ────────────────────────────
 *
 * Ele carregava a tabela de tamanhos de deck (8 formatos), a lista de formatos
 * com comandante e a regra de banidas — escritas à mão, aqui, num pacote que só
 * o backend importa. Três consequências:
 *
 *  1. **O CLIENTE NÃO TINHA ACESSO A NENHUMA REGRA.** Por isso o deckbuilder
 *     avisava "o formato Commander exige exatas 100" com um `if` fixo no
 *     componente: era a única regra que alguém tinha transcrito para o
 *     frontend, e ela aparecia em deck de Modern porque não havia formato
 *     nenhum a consultar. O bug que o usuário relatou nasce exatamente aqui.
 *  2. **AS REGRAS DE MAGIC QUE FALTAVAM.** Limite de 4 cópias, singleton,
 *     identidade de cor, restritas do Vintage, teto de raridade do Pauper,
 *     teto da reserva — nada disso existia. Um deck de Modern com quarenta
 *     Lightning Bolt passava por aqui sem um aviso.
 *  3. **A LISTA DE FORMATOS DIVERGIA** da do `<select>` do deckbuilder e da do
 *     painel de criar mesa. Três listas, três verdades.
 *
 * As regras agora vivem em `@aethertable/shared-types` (`format.ts` e
 * `legalidade.ts`), onde o frontend também as lê. O que sobra aqui é o que é
 * específico do backend: transformar o resultado em exceção HTTP e registrar o
 * que merece log.
 *
 * ─── O BLOQUEIO CONTINUA ESTREITO (RN01 / RN05) ────────────────────────────
 *
 * O sandbox avisa, não impede (DOC-037 §2). O validador compartilhado marca
 * como `'erro'` apenas o que a mesa não consegue montar de forma coerente
 * (formato de comandante sem comandante) ou o que a plataforma não deve
 * hospedar (carta banida no formato anunciado). Todo o resto é aviso, e o deck
 * entra.
 *
 * Isso é uma MUDANÇA de comportamento e vale registrar: antes, um deck de
 * Commander com 99 cartas era recusado no `join` com 400. Agora ele entra, com
 * o aviso à vista no deckbuilder — que é o que o documento sempre pediu.
 */

const logger = new Logger('formato');

/** O mínimo que a validação precisa saber sobre uma carta do deck. */
export type CartaDoDeck = CartaValidavel;
export type DeckValidavel = DeckValidavelCompartilhado;

/** Soma as cartas contáveis (main + comando + feitiço-assinatura). */
export const contarCartas = contarCartasCompartilhado;

/**
 * Recusa o deck que não pode entrar numa mesa deste formato.
 *
 * `formatoDaSala` vence `deck.formatId` quando informado: a sala é que define o
 * que está sendo jogado. Sem isso, levar um deck marcado como "commander" para
 * uma sala de Modern passaria pela regra errada.
 */
export function validarDeckParaFormato(deck: DeckValidavel, formatoDaSala?: string): void {
  const resultado = avaliarLegalidade(deck, formatoDaSala);

  // Contador divergente não bloqueia ninguém, mas precisa aparecer no log: é o
  // sintoma de uma escrita que falhou pela metade (`cardCount` é mantido por
  // increment/decrement em statements separados da escrita da carta).
  const dessincronizado = resultado.achados.find((a) => a.codigo === 'CONTADOR_DESSINCRONIZADO');
  if (dessincronizado) {
    logger.warn(
      `[decks] cardCount dessincronizado: contador=${deck.cardCount}, real=${resultado.total}`,
    );
  }

  const erros = resultado.achados.filter((a) => a.gravidade === 'erro');
  if (erros.length > 0) {
    throw new BadRequestException(erros.map((e) => e.mensagem).join(' '));
  }
}

/**
 * A avaliação completa, para quem quer os avisos e não só o bloqueio.
 *
 * Reexportado daqui para os serviços do backend não precisarem saber que a
 * regra mora em `shared-types` — e para o dia em que uma regra precisar de
 * dado que só o banco tem, o ponto de costura já existir.
 */
export { avaliarLegalidade };
