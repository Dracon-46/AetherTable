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

import { randomUUID } from 'node:crypto';
import { zoneOrderKey, type Zone } from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import type { RoomState } from '../schema/RoomState';
import type { IntentContext } from '../intents/registry';
import { limparConcessoes, reconciliarCartaParaTodos } from './view-sync';

export function carta(state: RoomState, id: string): Card | undefined {
  return state.cards.get(id);
}

export function ordem(state: RoomState, playerId: string, zone: Zone) {
  return state.zoneOrder.get(zoneOrderKey(playerId, zone))?.items;
}

/** O maior `zIndex` entre as cartas na pilha — o topo dela. 0 com a pilha vazia. */
export function topoDaPilha(state: RoomState): number {
  let topo = 0;
  state.cards.forEach((c) => {
    if (c.zone === 'STACK' && c.zIndex > topo) topo = c.zIndex;
  });
  return topo;
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

/** Apaga as setas que partem de, ou apontam para, uma carta ou um jogador. */
function removerSetasDe(state: RoomState, id: string): void {
  state.arrows.forEach((seta, chave) => {
    if (seta.fromId === id || seta.toId === id) state.arrows.delete(chave);
  });
}

/**
 * Reaplica a permissao que o DONO deu sobre a zona inteira da carta.
 *
 * `limparConcessoes` apaga `revealedTo` — certo para a concessao sobre AQUELA
 * carta, errado para "deixei fulano ver meu grimorio": embaralhar, mulligan e
 * mandar ao fundo limpavam a carta e o observador perdia o grimorio que o dono
 * tinha aberto, embora `sharedZones` continuasse dizendo que sim.
 */
export function reaplicarPermissaoDeZona(state: RoomState, card: Card): void {
  const compartilhada = state.players.get(card.ownerId)?.sharedZones.get(card.zone);
  if (compartilhada) card.revealedTo = compartilhada;
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
    case 'SIDEBOARD':
      card.x = 0;
      card.y = 0;
      card.zIndex = 0;
      card.isTapped = false;
      card.faceDown = false;
      card.damage = 0;
      card.counters.clear();
      /**
       * ─── NA ZONA OCULTA, A CARTA NÃO LEVA MARCA NENHUMA ──────────────────
       *
       * Estes campos são PÚBLICOS — chegam a todo cliente, sem `view()` — e
       * sobreviviam à volta para a mão ou o grimório. Uma carta com anotação,
       * destaque, P/T alterado ou girada no campo continuava com a marca no
       * grimório: quem acompanhava a marca sabia qual era aquela carta de
       * costas, e onde ela estava depois de comprada. Zona oculta é
       * exatamente o lugar em que a carta não pode ser distinguível das outras.
       */
      card.rotation = 0;
      card.phasedOut = false;
      card.isFlipped = false;
      card.note = '';
      card.highlight = '';
      card.exiledBy = '';
      card.goadedBy = '';
      card.powerOverride = 0;
      card.toughnessOverride = 0;
      card.hasPtOverride = false;
      card.enteredThisTurn = false;
      break;
    case 'GRAVEYARD':
    case 'EXILE':
    case 'COMMAND':
      card.isTapped = false;
      card.damage = 0;
      card.counters.clear();
      break;
    /**
     * ─── A PILHA: PÚBLICA, E EM ORDEM ENTRE TODOS OS JOGADORES ──────────────
     *
     * A zona existia no contrato e nada a usava. A ordem da pilha é da MESA,
     * não de cada jogador — a mágica do oponente em resposta à sua fica por
     * cima —, então ela não sai das listas de `zoneOrder` (uma por dono): sai
     * do `zIndex`, que vira "a próxima posição no topo da pilha inteira".
     * Sem motor de regras (RN01), resolver é mover a carta para onde ela vai.
     */
    case 'STACK':
      card.isTapped = false;
      card.damage = 0;
      card.counters.clear();
      card.zIndex = topoDaPilha(ctx.state) + 1;
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

  /**
   * FORA DO CAMPO, NADA FICA PENDURADO NA CARTA.
   *
   * `attachedTo` nunca era limpo: a aura que ia para o cemiterio voltava
   * "anexada", e o hospedeiro que morria deixava as auras apontando para uma
   * carta no cemiterio. As setas tambem sobreviviam — a de uma criatura morta
   * reaparecia quando ela voltava ao campo.
   */
  if (destino !== 'BATTLEFIELD') {
    card.attachedTo = '';
    ctx.state.cards.forEach((outra) => {
      if (outra.attachedTo === card.id) outra.attachedTo = '';
    });
    // A pilha é a exceção das setas: "conjuro isto naquilo" é a seta da mão
    // que segue a mágica até a pilha — é ali que o alvo importa. Ela some
    // quando a mágica resolve (pilha → cemitério).
    if (destino !== 'STACK') removerSetasDe(ctx.state, card.id);
  }

  // Fichas deixam de existir fora do campo. A pilha é a exceção: a cópia de
  // uma mágica é uma ficha que VIVE na pilha, e deixa de existir quando sai
  // dela (707.10) — que é exatamente esta mesma regra, aplicada na saída.
  if (card.isToken && destino !== 'BATTLEFIELD' && destino !== 'STACK') {
    // Quem chama ja empurrou o id na lista de ordem do destino. Apagar so a
    // carta deixava o id orfao la: o topo do cemiterio e lido da ORDEM, e
    // depois de uma ficha morrer a pilha mostrava um topo vazio por cima das
    // cartas de verdade.
    const lista = ordem(ctx.state, card.ownerId, destino);
    const i = lista ? lista.indexOf(card.id) : -1;
    if (lista && i !== -1) lista.splice(i, 1);
    ctx.state.cards.delete(card.id);
    // Sem reconciliar: tirar do mapa ja some com a carta para todas as views,
    // e `view.add` numa instancia desanexada LANCA no Colyseus — mover uma
    // ficha virada para fora do campo respondia INTERNAL e abortava o lote.
    return;
  }

  reconciliarCartaParaTodos(ctx.clients, card);
}

/**
 * ─── DEPOIS DE EMBARALHAR, AS CARTAS TROCAM DE IDENTIDADE ───────────────────
 *
 * O `Card.id` é público e permanente: chega a todo cliente, em `cards` e em
 * `zoneOrder`. Embaralhar mudava a POSIÇÃO de cada id, mas não o id — então
 * qualquer carta vista uma vez (revelada, devolvida de uma zona pública ao
 * grimório, ou marcada no provisionamento) continuava rastreável através de
 * todo embaralhamento, e a "ordem aleatória" era aleatória só para quem não
 * prestava atenção.
 *
 * Aqui cada id da lista que não está em `manter` vira uma carta NOVA, com id
 * novo, e a antiga sai do mapa. Do lado de fora, o que se vê é: N cartas
 * sumiram, N cartas nasceram, em ordem de grimório. Não há fio ligando uma à
 * outra.
 *
 * `randomUUID` e não `services/rng.ts`: isto é IDENTIDADE, não sorteio de
 * jogo. A RN06 governa o que decide o resultado da partida (ordem, dado,
 * moeda); o id só precisa ser imprevisível e único, que é o que o UUID v4 do
 * `node:crypto` (CSPRNG) já garante.
 *
 * A carta nova herda só o que a carta É e de quem é: dono, zona, identidade
 * (`scryfallId`), e as marcas de natureza (comandante, ficha, cópia). O
 * controle volta ao dono (fora do campo não existe controle alheio), e a
 * permissão de zona que o dono deu (`sharedZones`) é reaplicada. Concessões
 * POR CARTA (olhada, revelação) não passam: embaralhar já as destruía.
 *
 * ─── RECEBE E DEVOLVE UM ARRAY, E NÃO MEXE NA LISTA DA ZONA ─────────────────
 *
 * Quem grava a zona é quem chama, UMA vez, com a operação que já usava. O
 * `ArraySchema` do schema 3 não aguenta duas operações de reescrita no mesmo
 * tick: o `splice` não atualiza a lista interna que o `pop` consulta, e um
 * `pop` depois de um `splice` devolve `undefined` — o mulligan comprava zero
 * cartas. Um segundo `splice` seguido também perde o índice e corrompe o patch.
 *
 * Devolve os ids na mesma ordem, com os renovados trocados.
 */
export function renovarIds(
  ctx: Pick<IntentContext, 'state' | 'clients'>,
  ids: readonly string[],
  manter: ReadonlySet<string> = new Set(),
): string[] {
  const { state } = ctx;
  const trocas = new Map<string, string>();

  const nova = ids.map((id) => {
    const antiga = state.cards.get(id);
    if (!antiga || manter.has(id)) return id;
    const c = new Card();
    c.id = randomUUID();
    c.ownerId = antiga.ownerId;
    c.controllerId = antiga.ownerId;
    c.zone = antiga.zone;
    c.scryfallId = antiga.scryfallId;
    c.isCommander = antiga.isCommander;
    c.isToken = antiga.isToken;
    c.isCopy = antiga.isCopy;
    reaplicarPermissaoDeZona(state, c);
    state.cards.delete(id);
    state.cards.set(c.id, c);
    trocas.set(id, c.id);
    return c.id;
  });
  if (trocas.size === 0) return nova;

  desligarReferencias(state, trocas);
  // A carta nova não está em view nenhuma: sem reconciliar, o dono deixaria de
  // ver a própria mão embaralhada, e quem tem a zona aberta perderia a vista.
  for (const novoId of trocas.values()) {
    const c = state.cards.get(novoId);
    if (c) reconciliarCartaParaTodos(ctx.clients, c);
  }
  return nova;
}

/**
 * O que apontava para uma carta renovada.
 *
 * REMAPEAR seria publicar, no mesmo patch, "o antigo X agora se chama Y" — o
 * fio que a renovação existe para cortar. Por isso quase tudo é LIMPO: seta,
 * anexo, "exilada por", "provocada por", portador do Anel e o topo revelado.
 * São marcas do campo, e a carta já saiu dele; o topo revelado o servidor
 * recalcula no fim do despacho (`aplicarTopoRevelado`).
 *
 * A exceção é o DANO DE COMANDANTE, que é contabilidade de derrota e não pode
 * sumir num embaralhamento. Ele é remapeado — e isso não vaza nada, porque
 * `isCommander` é público: o comandante já é distinguível das outras cartas.
 */
function desligarReferencias(state: RoomState, trocas: ReadonlyMap<string, string>): void {
  for (const [antigo, novo] of trocas) {
    if (!state.cards.get(novo)?.isCommander) continue;
    state.players.forEach((p) => {
      const valor = p.commanderDamage.get(antigo);
      if (valor === undefined) return;
      p.commanderDamage.delete(antigo);
      p.commanderDamage.set(novo, valor);
    });
  }

  state.players.forEach((p) => {
    if (trocas.has(p.ringBearerId)) p.ringBearerId = '';
    if (trocas.has(p.topoReveladoId)) p.topoReveladoId = '';
  });
  state.cards.forEach((c) => {
    if (trocas.has(c.attachedTo)) c.attachedTo = '';
    if (trocas.has(c.exiledBy)) c.exiledBy = '';
    if (trocas.has(c.goadedBy)) c.goadedBy = '';
  });
  state.arrows.forEach((seta, chave) => {
    if (trocas.has(seta.fromId) || trocas.has(seta.toId)) state.arrows.delete(chave);
  });
}
