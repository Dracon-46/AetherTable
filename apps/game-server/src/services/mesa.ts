/**
 * mesa.ts — o acesso ao estado da mesa que TODA familia de intencao precisa.
 *
 * As cinco funcoes daqui viviam privadas em `intents/registry.ts`, e isso
 * bastava enquanto todo handler morava naquele arquivo. Deixou de bastar
 * quando a familia de sorteio saiu para `intents/sorteios.ts`: importar o
 * registry de la criaria um ciclo em tempo de execucao (o registry monta os
 * sorteios), e duplicar `aplicarEfeitosDeZona` seria duplicar a regra mais
 * facil de errar do modelo — a limpeza de concessoes de visibilidade.
 *
 * Nada aqui mudou de comportamento: e o mesmo codigo, num lugar onde as duas
 * familias alcancam.
 */

import { zoneOrderKey, type Zone } from '@aethertable/shared-types';

import type { Card } from '../schema/Card';
import type { RoomState } from '../schema/RoomState';
import type { IntentContext } from '../intents/registry';
import { limparConcessoes, reconciliarCartaParaTodos } from './view-sync';

export function carta(state: RoomState, id: string): Card | undefined {
  return state.cards.get(id);
}

export function ordem(state: RoomState, playerId: string, zone: Zone) {
  return state.zoneOrder.get(zoneOrderKey(playerId, zone))?.items;
}

export function nomeDe(state: RoomState, sid: string): string {
  // A plateia entra na busca por causa do CHAT, que e a unica coisa que um
  // espectador consegue disparar. Sem esta linha o comentario dele chegava
  // assinado por "Alguem" — e a mesa nao tinha como saber quem falou.
  return state.players.get(sid)?.name ?? state.espectadores.get(sid)?.name ?? 'Alguem';
}

export function atualizarContagens(state: RoomState, playerId: string): void {
  const player = state.players.get(playerId);
  if (!player) return;
  player.handCount = ordem(state, playerId, 'HAND')?.length ?? 0;
  player.libraryCount = ordem(state, playerId, 'LIBRARY')?.length ?? 0;
}

/**
 * Efeitos colaterais obrigatorios de toda troca de zona (DOC-032 §2.1).
 * Inclui a limpeza de concessoes — o erro mais facil de cometer neste modelo.
 */
export function aplicarEfeitosDeZona(ctx: IntentContext, card: Card, destino: Zone): void {
  limparConcessoes(card);

  /**
   * REAPLICA A PERMISSAO DE ZONA (ver `Player.sharedZones`).
   *
   * `limparConcessoes` acabou de apagar `revealedTo` — o que e correto para uma
   * concessao sobre AQUELA carta. Mas "deixei fulano ver a minha mao" e uma
   * concessao sobre a ZONA: sem esta linha, a permissao morria na primeira
   * compra e o observador ficava vendo versos.
   */
  const dono = ctx.state.players.get(card.ownerId);
  const compartilhada = dono?.sharedZones.get(destino);
  if (compartilhada) card.revealedTo = compartilhada;

  switch (destino) {
    case 'HAND':
    case 'LIBRARY':
      card.x = 0;
      card.y = 0;
      card.zIndex = 0;
      card.isTapped = false;
      card.faceDown = false;
      card.damage = 0;
      card.counters.clear();
      break;
    case 'GRAVEYARD':
    case 'EXILE':
    case 'COMMAND':
      card.isTapped = false;
      card.damage = 0;
      card.counters.clear();
      break;
    case 'BATTLEFIELD':
      // Mantem tapped/counters apenas se veio do proprio Battlefield.
      if (card.zone !== 'BATTLEFIELD') {
        card.isTapped = false;
        card.counters.clear();
      }
      break;
    default:
      break;
  }

  card.zone = destino;
  card.lockedBy = '';

  /**
   * O CONTROLE VOLTA AO DONO AO SAIR DO CAMPO (DOC-052 §2.1).
   *
   * `INTENT_SET_CONTROLLER` deixa uma permanente sob controle alheio. Sem este
   * reset, a carta roubada continuava com `controllerId` do ladrão depois de
   * morrer: ela ia para o cemitério do DONO (`ownerId` nunca muda) mas
   * continuava desenhada na faixa do ladrão, e — pior — a autorização
   * `CONTROLLER` continuava valendo. Na prática, quem roubou uma criatura uma
   * vez ganhava permissão permanente de mexer numa carta que agora está numa
   * zona do adversário.
   *
   * Controle é um estado do campo de batalha; fora dele não existe.
   */
  if (destino !== 'BATTLEFIELD' && card.controllerId !== card.ownerId) {
    card.controllerId = card.ownerId;
  }

  // Fichas deixam de existir fora do campo.
  if (card.isToken && destino !== 'BATTLEFIELD') {
    ctx.state.cards.delete(card.id);
  }

  reconciliarCartaParaTodos(ctx.clients, card);
}
