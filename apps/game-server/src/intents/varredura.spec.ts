/**
 * varredura.spec.ts — o que a auditoria de mesa achou e nenhum teste via.
 *
 * Cada caso aqui falhava contra o código de antes desta leva. Os handlers são
 * chamados pelo caminho de verdade sempre que isso importa: autorização via
 * `verificarAutorizacao` (o DETACH só quebrava ali) e desfazer via
 * `HistoricoDeComandos` (o UNDO só quebrava ali).
 */

import { ZONES, zoneOrderKey } from '@aethertable/shared-types';
import { REGISTRY, verificarAutorizacao } from './registry';
import type { IntentContext } from './registry';
import { ComandoDeIntencao, HistoricoDeComandos } from './comandos';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { Card } from '../schema/Card';
import { Arrow } from '../schema/Arrow';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import { podeVer } from '../schema/visibility';

const U = (i: number) => `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`;

function montarMesa(assentos: string[]) {
  const state = new RoomState();
  state.phase = 'PLAYING';
  state.maxSeats = 8;
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.name = id.toUpperCase();
    p.seat = indice;
    p.connected = true;
    state.players.set(id, p);
    for (const zone of ZONES) state.zoneOrder.set(zoneOrderKey(id, zone), new ZoneOrderList());
  });
  return state;
}

function poe(state: RoomState, id: string, dono: string, zona: string, extra: Partial<Card> = {}) {
  const c = new Card();
  c.id = id;
  c.ownerId = dono;
  c.controllerId = dono;
  c.zone = zona;
  c.scryfallId = `scry-${id}`;
  Object.assign(c, extra);
  state.cards.set(c.id, c);
  state.zoneOrder.get(zoneOrderKey(dono, zona as never))?.items.push(c.id);
  return c;
}

const lista = (state: RoomState, dono: string, zona: string) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(dono, zona as never))!.items);

function ctx(state: RoomState, sid: string, historico?: HistoricoDeComandos): IntentContext {
  return {
    state,
    client: { sessionId: sid } as IntentContext['client'],
    clients: [],
    send: () => {},
    broadcast: () => {},
    log: () => {},
    desfazer: () => historico?.desfazer(sid) ?? null,
    expulsar: () => {},
  } as IntentContext;
}

/** O caminho da Room: autorização, depois o comando pelo histórico. */
function despachar(
  state: RoomState,
  historico: HistoricoDeComandos,
  tipo: keyof typeof REGISTRY,
  sid: string,
  payload: unknown,
): string | null {
  const handler = REGISTRY[tipo] as never;
  const recusa = verificarAutorizacao(handler, state, sid, payload);
  if (recusa) return recusa;
  historico.executar(
    new ComandoDeIntencao(tipo, handler, ctx(state, sid, historico), payload, state),
  );
  return null;
}

describe('visibilidade', () => {
  /** Marcar o grimório como "virado" dava ao dono a leitura do grimório inteiro. */
  it('carta virada no grimório continua invisível, até para o dono', () => {
    const state = montarMesa(['a']);
    const c = poe(state, U(1), 'a', 'LIBRARY');
    REGISTRY.INTENT_BATCH_UPDATE.executa(ctx(state, 'a'), {
      entityIds: [c.id],
      property: 'faceDown',
      value: true,
    } as never);
    expect(podeVer(c, 'a')).toBe(false);
    // E, por garantia, a regra em si: virada fora de zona pública não abre nada.
    c.faceDown = true;
    expect(podeVer(c, 'a')).toBe(false);
  });

  it('cópia de carta da mão revelada só para mim não vira ficha pública', () => {
    const state = montarMesa(['a', 'b']);
    const segredo = poe(state, U(2), 'b', 'HAND', { revealedTo: 'a' });
    REGISTRY.INTENT_COPY_CARD.executa(ctx(state, 'a'), { entityId: segredo.id } as never);
    expect(Array.from(state.cards.values()).some((x) => x.isCopy)).toBe(false);
  });
});

describe('anexos, setas e contadores', () => {
  it('desanexar passa pela autorização e solta a aura', () => {
    const state = montarMesa(['a']);
    const historico = new HistoricoDeComandos();
    poe(state, U(3), 'a', 'BATTLEFIELD');
    const aura = poe(state, U(4), 'a', 'BATTLEFIELD', { attachedTo: U(3) });
    expect(despachar(state, historico, 'INTENT_DETACH', 'a', { childId: aura.id })).toBeNull();
    expect(aura.attachedTo).toBe('');
  });

  it('o hospedeiro que morre solta as auras, e a aura no cemitério não volta anexada', () => {
    const state = montarMesa(['a']);
    const hospede = poe(state, U(5), 'a', 'BATTLEFIELD');
    const aura = poe(state, U(6), 'a', 'BATTLEFIELD', { attachedTo: U(5) });
    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: hospede.id,
      targetZone: 'GRAVEYARD',
    } as never);
    expect(aura.attachedTo).toBe('');
  });

  it('a seta de uma criatura que morre some junto', () => {
    const state = montarMesa(['a', 'b']);
    const c = poe(state, U(7), 'a', 'BATTLEFIELD');
    const seta = new Arrow();
    seta.id = 's1';
    seta.ownerId = 'a';
    seta.fromId = c.id;
    seta.toId = 'b';
    state.arrows.set(seta.id, seta);
    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: c.id,
      targetZone: 'GRAVEYARD',
    } as never);
    expect(state.arrows.size).toBe(0);
  });

  /**
   * `splice` com inserção LANÇA no ArraySchema do Colyseus 3: "para o fundo do
   * grimório" e a devolução do London viravam "Erro interno na mesa".
   */
  it('mover para o grimório numa posição: fundo e meio', () => {
    const state = montarMesa(['a']);
    ['g1', 'g2', 'g3'].forEach((id, i) => poe(state, U(20 + i), 'a', 'LIBRARY', { id }));
    const naMao = poe(state, U(30), 'a', 'HAND');
    const outra = poe(state, U(31), 'a', 'HAND');

    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: naMao.id,
      targetZone: 'LIBRARY',
      index: 0,
    } as never);
    expect(lista(state, 'a', 'LIBRARY')[0]).toBe(naMao.id);

    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: outra.id,
      targetZone: 'LIBRARY',
      index: 2,
    } as never);
    expect(lista(state, 'a', 'LIBRARY')).toHaveLength(5);
    expect(lista(state, 'a', 'LIBRARY')[2]).toBe(outra.id);
  });

  /** "Conjuro isto naquilo": a seta da mão segue a mágica até a pilha. */
  it('a seta da mão sobrevive à pilha e some quando a mágica resolve', () => {
    const state = montarMesa(['a', 'b']);
    const c = poe(state, U(9), 'a', 'HAND');
    const seta = new Arrow();
    seta.id = 's2';
    seta.ownerId = 'a';
    seta.fromId = c.id;
    seta.toId = 'b';
    state.arrows.set(seta.id, seta);

    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: c.id,
      targetZone: 'STACK',
    } as never);
    expect(state.arrows.has('s2')).toBe(true);

    REGISTRY.INTENT_CHANGE_ZONE.executa(ctx(state, 'a'), {
      entityId: c.id,
      targetZone: 'GRAVEYARD',
    } as never);
    expect(state.arrows.size).toBe(0);
  });

  it('tirar marcador em lote de quem não tem não grava valor negativo', () => {
    const state = montarMesa(['a']);
    const c = poe(state, U(8), 'a', 'BATTLEFIELD');
    REGISTRY.INTENT_BATCH_COUNTER.executa(ctx(state, 'a'), {
      entityIds: [c.id],
      name: '+1/+1',
      amount: -1,
    });
    expect(c.counters.has('+1/+1')).toBe(false);
  });

  it('REORDER com id repetido é recusado e nada some da ordem', () => {
    const state = montarMesa(['a']);
    const ids = [U(9), U(10), U(11)].map((id) => poe(state, id, 'a', 'GRAVEYARD').id);
    REGISTRY.INTENT_REORDER.executa(ctx(state, 'a'), {
      zone: 'GRAVEYARD',
      ids: [ids[0], ids[0], ids[1]],
    } as never);
    expect(lista(state, 'a', 'GRAVEYARD').sort()).toEqual([...ids].sort());
  });
});

describe('permissão de zona sobrevive ao embaralhar', () => {
  it('quem o dono deixou ver o grimório continua vendo depois de embaralhar', () => {
    const state = montarMesa(['a', 'b']);
    state.players.get('a')!.sharedZones.set('LIBRARY', 'b');
    const c = poe(state, U(12), 'a', 'LIBRARY', { revealedTo: 'b' });
    poe(state, U(13), 'a', 'LIBRARY', { revealedTo: 'b' });
    REGISTRY.INTENT_SHUFFLE.executa(ctx(state, 'a'), { zone: 'LIBRARY' } as never);
    expect(podeVer(c, 'b')).toBe(true);
  });
});

describe('desfazer', () => {
  it('o UNDO pela Room desfaz o TAP anterior', () => {
    const state = montarMesa(['a']);
    const historico = new HistoricoDeComandos();
    const c = poe(state, U(14), 'a', 'BATTLEFIELD');
    despachar(state, historico, 'INTENT_TAP', 'a', { entityId: c.id, tapped: true });
    despachar(state, historico, 'INTENT_UNDO', 'a', {});
    expect(c.isTapped).toBe(false);
  });

  /** Comprar, olhar e desfazer devolvia as cartas ao topo JÁ conhecidas. */
  it('comprar não se desfaz', () => {
    const state = montarMesa(['a']);
    const historico = new HistoricoDeComandos();
    poe(state, U(15), 'a', 'LIBRARY');
    despachar(state, historico, 'INTENT_DRAW', 'a', { amount: 1 });
    expect(historico.desfazer('a')).toBeNull();
  });

  it('arrastar do grimório para a mão também não se desfaz', () => {
    const state = montarMesa(['a']);
    const historico = new HistoricoDeComandos();
    const c = poe(state, U(16), 'a', 'LIBRARY');
    despachar(state, historico, 'INTENT_CHANGE_ZONE', 'a', { entityId: c.id, targetZone: 'HAND' });
    expect(historico.desfazer('a')).toBeNull();
  });

  /**
   * Quem controlava a carta alheia, mandava para o grimório do dono e desfazia,
   * deixava o id no grimório do dono — a próxima compra dele puxava a carta do
   * campo do outro.
   */
  it('desfazer quem controla carta alheia conserta as listas do dono', () => {
    const state = montarMesa(['a', 'b']);
    const historico = new HistoricoDeComandos();
    const x = poe(state, U(17), 'a', 'BATTLEFIELD', { controllerId: 'b' });
    poe(state, U(18), 'a', 'LIBRARY');

    despachar(state, historico, 'INTENT_CHANGE_ZONE', 'b', { entityId: x.id, targetZone: 'HAND' });
    despachar(state, historico, 'INTENT_UNDO', 'b', {});

    expect(x.zone).toBe('BATTLEFIELD');
    expect(lista(state, 'a', 'HAND')).not.toContain(x.id);
    expect(state.players.get('a')!.handCount).toBe(0);
  });
});

describe('partida', () => {
  it('reiniciar devolve as cartas ao grimório, as fichas somem e o comandante volta', () => {
    const state = montarMesa(['a', 'b']);
    const campo = poe(state, U(19), 'a', 'BATTLEFIELD', { isTapped: true });
    const mao = poe(state, U(20), 'a', 'HAND');
    const ficha = poe(state, U(21), 'a', 'BATTLEFIELD', { isToken: true });
    const cmd = poe(state, U(22), 'a', 'GRAVEYARD', { isCommander: true });

    REGISTRY.INTENT_RESET_MATCH.executa(ctx(state, 'a'), {});

    expect(state.cards.has(ficha.id)).toBe(false);
    expect(lista(state, 'a', 'LIBRARY').sort()).toEqual([campo.id, mao.id].sort());
    expect(lista(state, 'a', 'COMMAND')).toEqual([cmd.id]);
    expect(lista(state, 'a', 'BATTLEFIELD')).toEqual([]);
    expect(campo.isTapped).toBe(false);
    expect(state.players.get('a')!.handCount).toBe(0);
    expect(state.players.get('a')!.libraryCount).toBe(2);
  });

  it('ordem de turno com id repetido é recusada', () => {
    const state = montarMesa(['a', 'b', 'c']);
    REGISTRY.INTENT_SET_TURN_ORDER.executa(ctx(state, 'a'), { order: ['b', 'c', 'c'] });
    const assentos = new Set(Array.from(state.players.values()).map((p) => p.seat));
    expect(assentos.size).toBe(3);
  });

  it('quem volta dos mortos depois do fim reabre a partida', () => {
    const state = montarMesa(['a', 'b']);
    REGISTRY.INTENT_SET_LIFE.executa(ctx(state, 'b'), { absolute: 0 });
    expect(state.phase).toBe('CLOSING');

    REGISTRY.INTENT_SET_LIFE.executa(ctx(state, 'b'), { absolute: 5 });
    expect(state.phase).toBe('PLAYING');
  });
});
