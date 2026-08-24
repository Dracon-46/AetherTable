import type { Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import type { Card } from '../schema/Card';
import type { RoomState } from '../schema/RoomState';
import { podeVer } from '../schema/visibility';

/**
 * Ponte entre `podeVer()` e o StateView do Colyseus.
 *
 * Como `Card.scryfallId` esta marcado com `view()`, ele e invisivel por padrao.
 * Este modulo e o UNICO lugar que concede essa visibilidade — e sempre
 * RECALCULANDO a partir de `podeVer`, nunca aplicando deltas.
 *
 * Por que recalcular em vez de aplicar delta: delta acumula erro. Um `add` sem o
 * `remove` correspondente e um vazamento permanente, e e exatamente o erro mais
 * facil de cometer neste modelo (DOC-032 §4.1.2). Recalcular e idempotente: se o
 * direito acabou, a inscricao cai, independentemente de quantas vezes foi
 * concedida.
 */

/** Garante que o cliente tem uma StateView. Sem ela, ele veria tudo. */
export function garantirView(client: Client): StateView {
  if (!client.view) {
    client.view = new StateView();
  }
  return client.view;
}

/** Reconcilia a inscricao de UMA carta para UM cliente. */
export function reconciliarCarta(client: Client, card: Card): void {
  const view = garantirView(client);
  const permitido = podeVer(card, client.sessionId);
  const inscrito = view.has(card);

  if (permitido && !inscrito) {
    view.add(card);
  } else if (!permitido && inscrito) {
    view.remove(card);
  }
}

/** Reconcilia UMA carta para TODOS os clientes. Use apos mutar essa carta. */
export function reconciliarCartaParaTodos(clients: Iterable<Client>, card: Card): void {
  for (const client of clients) {
    reconciliarCarta(client, card);
  }
}

/** Reconcilia TODAS as cartas para UM cliente. Use no join e no reconnect. */
export function reconciliarClient(client: Client, state: RoomState): void {
  garantirView(client);
  state.cards.forEach((card) => reconciliarCarta(client, card));
}

/**
 * Reconciliacao completa: todas as cartas para todos os clientes.
 *
 * Custo: O(cartas x clientes). Com o teto de 300–400 objetos e 4 jogadores, sao
 * ~1.600 avaliacoes — barato o suficiente para rodar em qualquer mutacao de
 * visibilidade, e ordens de magnitude menos que o `@filter` original, que rodava
 * por encode.
 *
 * Ainda assim: prefira `reconciliarCartaParaTodos` quando so uma carta mudou.
 */
export function reconciliarTudo(clients: Iterable<Client>, state: RoomState): void {
  for (const client of clients) {
    reconciliarClient(client, state);
  }
}

/**
 * Limpeza OBRIGATORIA em troca de zona (DOC-032 §4.1.2).
 *
 * Sem isso o vazamento e permanente: uma carta revelada na mao que vai ao campo
 * e volta a mao continuaria visivel a todos para sempre. O chamador deve
 * reconciliar depois — `aplicarEfeitosDeZona` faz as duas coisas.
 */
export function limparConcessoes(card: Card): void {
  card.revealedTo = '';
  card.peekedBy = '';
}
