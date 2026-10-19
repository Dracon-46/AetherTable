/**
 * identidade-e-tetos.spec.ts — o id da carta não denuncia o grimório (C1), o
 * estado não incha até derrubar a sala (A2), a votação não vira decisão de uma
 * pessoa só (M1) e só quem está na mesa age nela.
 *
 * O caminho é o do despacho real: schema Zod, depois o handler — e, quando
 * importa, o histórico de comandos.
 */

import { ZONES, zoneOrderKey, type LogEvent, type Zone } from '@aethertable/shared-types';
import type { Client } from '@colyseus/core';
import type { z } from 'zod';
import { REGISTRY, LIMITES_DA_MESA, barreiraDoRemetente } from './registry';
import type { IntentContext, IntentHandler } from './registry';
import { ComandoDeIntencao, HistoricoDeComandos } from './comandos';
import * as S from './schemas';
import { Arrow } from '../schema/Arrow';
import { Card } from '../schema/Card';
import { Espectador } from '../schema/Espectador';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';

const U = (i: number) => `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`;

function montarMesa(assentos: string[]) {
  const state = new RoomState();
  state.phase = 'PLAYING';
  state.maxSeats = 8;
  assentos.forEach((id, indice) => {
    const p = new Player();
    p.id = id;
    p.userId = `conta-${id}`;
    p.name = id.toUpperCase();
    p.seat = indice;
    p.connected = true;
    state.players.set(id, p);
    for (const zone of ZONES) state.zoneOrder.set(zoneOrderKey(id, zone), new ZoneOrderList());
  });
  return state;
}

let proximo = 1;
function poe(state: RoomState, dono: string, zona: Zone, extra: Partial<Card> = {}) {
  const c = new Card();
  c.id = U(proximo);
  proximo += 1;
  c.ownerId = dono;
  c.controllerId = dono;
  c.zone = zona;
  c.scryfallId = `scry-${c.id}`;
  Object.assign(c, extra);
  state.cards.set(c.id, c);
  if (zona !== 'BATTLEFIELD') state.zoneOrder.get(zoneOrderKey(dono, zona))!.items.push(c.id);
  return c;
}

const lista = (state: RoomState, dono: string, zona: Zone) =>
  Array.from(state.zoneOrder.get(zoneOrderKey(dono, zona))!.items);

const identidades = (state: RoomState, ids: readonly string[]) =>
  ids.map((id) => state.cards.get(id)!.scryfallId).sort();

interface Mesa {
  state: RoomState;
  enviados: { evento: string; payload: Record<string, unknown> }[];
  logs: LogEvent[];
  expulsos: string[];
  clients: Client[];
  invalidou: number;
}

function mesa(assentos: string[]): Mesa {
  return {
    state: montarMesa(assentos),
    enviados: [],
    logs: [],
    expulsos: [],
    clients: [],
    invalidou: 0,
  };
}

function ctx(m: Mesa, sid: string): IntentContext {
  return {
    state: m.state,
    client: { sessionId: sid } as Client,
    clients: m.clients,
    send: (evento, payload) =>
      m.enviados.push({ evento, payload: payload as Record<string, unknown> }),
    broadcast: () => {},
    log: (entrada) => m.logs.push(entrada),
    desfazer: () => null,
    invalidarDesfazer: () => {
      m.invalidou += 1;
    },
    expulsar: (id) => m.expulsos.push(id),
  };
}

/** Schema Zod e depois o handler — o caminho do despachante. */
function executar(m: Mesa, tipo: keyof typeof REGISTRY, sid: string, payload: unknown) {
  const h = REGISTRY[tipo] as IntentHandler<z.ZodTypeAny>;
  h.executa(ctx(m, sid), h.schema.parse(payload));
}

const erros = (m: Mesa) => m.enviados.filter((e) => e.evento === 'error').map((e) => e.payload);

// ═══════════════════════════════════════════════════════════════════════════
//  C1 — o embaralhar troca a identidade das cartas
// ═══════════════════════════════════════════════════════════════════════════

describe('embaralhar renova os ids (C1)', () => {
  it('nenhum id antigo do grimório sobrevive ao SHUFFLE', () => {
    const m = mesa(['a']);
    const antes = Array.from({ length: 8 }, () => poe(m.state, 'a', 'LIBRARY').id);
    const quem = identidades(m.state, antes);

    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'LIBRARY' });

    const depois = lista(m.state, 'a', 'LIBRARY');
    expect(depois).toHaveLength(8);
    for (const id of antes) {
      expect(depois).not.toContain(id);
      expect(m.state.cards.has(id)).toBe(false);
    }
    // As mesmas cartas, com outro nome.
    expect(identidades(m.state, depois)).toEqual(quem);
  });

  it('o topo mantido por keepTop é a única coisa que fica com o id', () => {
    const m = mesa(['a']);
    const antes = Array.from({ length: 6 }, () => poe(m.state, 'a', 'LIBRARY').id);
    const topo = antes.slice(-2);

    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'LIBRARY', keepTop: 2 });

    const depois = lista(m.state, 'a', 'LIBRARY');
    expect(depois.slice(-2)).toEqual(topo);
    for (const id of antes.slice(0, 4)) expect(depois).not.toContain(id);
  });

  it('a carta nova continua visível para quem tinha o grimório aberto', () => {
    const m = mesa(['a', 'b']);
    m.state.players.get('a')!.sharedZones.set('LIBRARY', 'b');
    poe(m.state, 'a', 'LIBRARY', { revealedTo: 'b' });

    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'LIBRARY' });

    const [nova] = lista(m.state, 'a', 'LIBRARY');
    expect(m.state.cards.get(nova!)!.revealedTo).toBe('b');
  });

  it('embaralhar a mão também renova, e o dono continua vendo as cartas', () => {
    const m = mesa(['a']);
    const dono = { sessionId: 'a', view: undefined } as unknown as Client;
    m.clients.push(dono);
    const antes = [poe(m.state, 'a', 'HAND').id, poe(m.state, 'a', 'HAND').id];

    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'HAND' });

    const depois = lista(m.state, 'a', 'HAND');
    for (const id of antes) expect(depois).not.toContain(id);
    for (const id of depois) expect(dono.view!.has(m.state.cards.get(id)!)).toBe(true);
  });

  it('zona pública embaralhada não troca de id (a identidade já é de todos)', () => {
    const m = mesa(['a']);
    const antes = [poe(m.state, 'a', 'GRAVEYARD').id, poe(m.state, 'a', 'GRAVEYARD').id];
    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'GRAVEYARD' });
    expect(lista(m.state, 'a', 'GRAVEYARD').sort()).toEqual([...antes].sort());
  });

  /** O `ArraySchema` do schema 3 devolvia `undefined` num `pop` depois de `splice`. */
  it('o mulligan compra sete cartas, todas com ids que a mesa nunca viu', () => {
    const m = mesa(['a']);
    const vistos = new Set<string>();
    for (let i = 0; i < 20; i += 1) vistos.add(poe(m.state, 'a', 'LIBRARY').id);
    for (let i = 0; i < 7; i += 1) vistos.add(poe(m.state, 'a', 'HAND').id);

    executar(m, 'INTENT_MULLIGAN', 'a', {});

    const mao = lista(m.state, 'a', 'HAND');
    expect(mao).toHaveLength(7);
    for (const id of [...mao, ...lista(m.state, 'a', 'LIBRARY')])
      expect(vistos.has(id)).toBe(false);
  });

  it('devolver o cemitério embaralhando renova; sem embaralhar, não', () => {
    const m = mesa(['a']);
    const cemiterio = [poe(m.state, 'a', 'GRAVEYARD').id, poe(m.state, 'a', 'GRAVEYARD').id];
    executar(m, 'INTENT_RETURN_ZONE', 'a', { from: 'GRAVEYARD', to: 'LIBRARY', shuffle: true });
    const grimorio = lista(m.state, 'a', 'LIBRARY');
    expect(grimorio).toHaveLength(2);
    for (const id of cemiterio) expect(grimorio).not.toContain(id);

    const m2 = mesa(['a']);
    const outro = poe(m2.state, 'a', 'GRAVEYARD').id;
    executar(m2, 'INTENT_RETURN_ZONE', 'a', { from: 'GRAVEYARD', to: 'LIBRARY', shuffle: false });
    expect(lista(m2.state, 'a', 'LIBRARY')).toEqual([outro]);
  });

  /** Desfazível, era "embaralhe, veja o topo, desfaça, repita até sair bom". */
  it('devolver uma zona ao grimório não se desfaz', () => {
    const m = mesa(['a']);
    poe(m.state, 'a', 'GRAVEYARD');
    const historico = new HistoricoDeComandos();
    const h = REGISTRY.INTENT_RETURN_ZONE as IntentHandler<z.ZodTypeAny>;
    historico.executar(
      new ComandoDeIntencao(
        'INTENT_RETURN_ZONE',
        h,
        ctx(m, 'a'),
        h.schema.parse({ from: 'GRAVEYARD', to: 'LIBRARY' }),
        m.state,
      ),
    );
    expect(historico.desfazer('a')).toBeNull();
  });

  it('o reset renova os grimórios e invalida o desfazer de todo mundo', () => {
    const m = mesa(['a', 'b']);
    const antes = [poe(m.state, 'a', 'HAND').id, poe(m.state, 'b', 'LIBRARY').id];
    executar(m, 'INTENT_RESET_MATCH', 'a', {});
    for (const id of antes) expect(m.state.cards.has(id)).toBe(false);
    expect(m.invalidou).toBe(1);
  });

  it('o que apontava para a carta renovada é desligado; o dano de comandante segue', () => {
    const m = mesa(['a', 'b']);
    const cmd = poe(m.state, 'a', 'LIBRARY', { isCommander: true });
    const exilada = poe(m.state, 'b', 'EXILE', { exiledBy: cmd.id, goadedBy: cmd.id });
    const aura = poe(m.state, 'b', 'BATTLEFIELD', { attachedTo: cmd.id });
    const seta = new Arrow();
    seta.id = `b:${aura.id}:${cmd.id}`;
    seta.ownerId = 'b';
    seta.fromId = aura.id;
    seta.toId = cmd.id;
    m.state.arrows.set(seta.id, seta);
    const b = m.state.players.get('b')!;
    b.commanderDamage.set(cmd.id, 7);
    const a = m.state.players.get('a')!;
    a.topoReveladoId = cmd.id;
    a.ringBearerId = cmd.id;

    executar(m, 'INTENT_SHUFFLE', 'a', { zone: 'LIBRARY' });

    const [novo] = lista(m.state, 'a', 'LIBRARY');
    expect(novo).not.toBe(cmd.id);
    expect(m.state.cards.get(novo!)!.isCommander).toBe(true);
    // Contabilidade de derrota: segue o comandante.
    expect(b.commanderDamage.get(novo!)).toBe(7);
    expect(b.commanderDamage.has(cmd.id)).toBe(false);
    // Marcas do campo: somem, para não publicar o vínculo antigo → novo.
    expect(exilada.exiledBy).toBe('');
    expect(exilada.goadedBy).toBe('');
    expect(aura.attachedTo).toBe('');
    expect(m.state.arrows.size).toBe(0);
    expect(a.topoReveladoId).toBe('');
    expect(a.ringBearerId).toBe('');
  });

  it('reordenar zona oculta vai ao log, sem dizer o que foi para onde', () => {
    const m = mesa(['a']);
    const ids = [poe(m.state, 'a', 'LIBRARY').id, poe(m.state, 'a', 'LIBRARY').id];
    executar(m, 'INTENT_REORDER', 'a', { zone: 'LIBRARY', ids: [...ids].reverse() });
    expect(m.logs).toHaveLength(1);
    expect(m.logs[0]).toMatchObject({ type: 'SHUFFLE', text: 'A reordenou o grimório' });
    expect(m.logs[0]).not.toHaveProperty('scryfallId');

    const publico = mesa(['a']);
    const gy = [poe(publico.state, 'a', 'GRAVEYARD').id, poe(publico.state, 'a', 'GRAVEYARD').id];
    executar(publico, 'INTENT_REORDER', 'a', { zone: 'GRAVEYARD', ids: [...gy].reverse() });
    expect(publico.logs).toHaveLength(0);
  });

  /** Anotação, destaque, P/T... são públicos e marcavam a carta dentro do grimório. */
  it('carta que volta para mão ou grimório perde toda marca pública', () => {
    const m = mesa(['a']);
    const c = poe(m.state, 'a', 'BATTLEFIELD', {
      note: 'a do combo',
      highlight: '#f00',
      rotation: 180,
      isFlipped: true,
      phasedOut: true,
      powerOverride: 5,
      toughnessOverride: 5,
      hasPtOverride: true,
      enteredThisTurn: true,
      exiledBy: U(999),
      goadedBy: 'b',
    });
    executar(m, 'INTENT_CHANGE_ZONE', 'a', { entityId: c.id, targetZone: 'LIBRARY' });
    expect(c).toMatchObject({
      note: '',
      highlight: '',
      rotation: 0,
      isFlipped: false,
      phasedOut: false,
      powerOverride: 0,
      toughnessOverride: 0,
      hasPtOverride: false,
      enteredThisTurn: false,
      exiledBy: '',
      goadedBy: '',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  A2 — tetos do estado
// ═══════════════════════════════════════════════════════════════════════════

describe('tetos do estado (A2)', () => {
  it('revelar só a quem está na mesa, sem repetir quem já vê', () => {
    const m = mesa(['a', 'b']);
    m.state.espectadores.set('olheiro', new Espectador());
    const c = poe(m.state, 'a', 'HAND', { revealedTo: 'b' });

    executar(m, 'INTENT_REVEAL', 'a', { ids: [c.id], to: ['b', 'b', 'olheiro', 'inventado'] });
    expect(c.revealedTo).toBe('b,olheiro');

    executar(m, 'INTENT_REVEAL', 'a', { ids: [c.id], to: ['inventado-1', 'inventado-2'] });
    expect(c.revealedTo).toBe('b,olheiro');
    expect(erros(m)[0]).toMatchObject({ code: 'INVALID_PAYLOAD', intent: 'INTENT_REVEAL' });
  });

  it('revelar e abrir zona também filtram, e abrir zona não grava repetição', () => {
    const m = mesa(['a', 'b']);
    const c = poe(m.state, 'a', 'HAND');
    executar(m, 'INTENT_REVEAL_ZONE', 'a', { zone: 'HAND', to: ['fantasma'] });
    expect(c.revealedTo).toBe('');
    executar(m, 'INTENT_SET_ZONE_VISIBILITY', 'a', { zone: 'HAND', to: ['b', 'b', 'fantasma'] });
    expect(c.revealedTo).toBe('b');
  });

  it('cada jogador tem no máximo 200 fichas', () => {
    const m = mesa(['a']);
    for (let i = 0; i < 10; i += 1)
      executar(m, 'INTENT_CREATE_TOKEN', 'a', { amount: 20, x: 0, y: 0 });
    expect(m.state.cards.size).toBe(LIMITES_DA_MESA.FICHAS_POR_JOGADOR);
    expect(erros(m)).toHaveLength(0);

    executar(m, 'INTENT_CREATE_TOKEN', 'a', { amount: 1, x: 0, y: 0 });
    expect(m.state.cards.size).toBe(LIMITES_DA_MESA.FICHAS_POR_JOGADOR);
    expect(erros(m)[0]).toMatchObject({ code: 'LIMIT', intent: 'INTENT_CREATE_TOKEN' });
  });

  it('a mesa inteira tem no máximo 1500 cartas', () => {
    const m = mesa(['a', 'b']);
    for (let i = 0; i < LIMITES_DA_MESA.CARTAS_NA_SALA - 5; i += 1) poe(m.state, 'b', 'LIBRARY');
    executar(m, 'INTENT_CREATE_TOKEN', 'a', { amount: 10, x: 0, y: 0 });
    expect(m.state.cards.size).toBe(LIMITES_DA_MESA.CARTAS_NA_SALA - 5);
    expect(erros(m)[0]).toMatchObject({ code: 'LIMIT' });
  });

  it('cópia conta como ficha de quem copiou', () => {
    const m = mesa(['a', 'b']);
    const alvo = poe(m.state, 'b', 'BATTLEFIELD');
    for (let i = 0; i < 10; i += 1)
      executar(m, 'INTENT_CREATE_TOKEN', 'a', { amount: 20, x: 0, y: 0 });
    executar(m, 'INTENT_COPY_CARD', 'a', { entityId: alvo.id });
    expect(Array.from(m.state.cards.values()).some((c) => c.isCopy)).toBe(false);
    expect(erros(m)[0]).toMatchObject({ code: 'LIMIT', intent: 'INTENT_COPY_CARD' });
  });

  it('o nome da ficha passa pela limpeza da anotação', () => {
    const m = mesa(['a']);
    executar(m, 'INTENT_CREATE_TOKEN', 'a', { name: '<img src=x>Elfo', amount: 1, x: 0, y: 0 });
    expect(Array.from(m.state.cards.values())[0]!.note).toBe('img src=xElfo');
  });

  it('no máximo 32 tipos de contador por carta — os que já existem seguem mexendo', () => {
    const m = mesa(['a']);
    const c = poe(m.state, 'a', 'BATTLEFIELD');
    for (let i = 0; i < LIMITES_DA_MESA.CONTADORES_POR_CARTA; i += 1) {
      executar(m, 'INTENT_ADD_COUNTER', 'a', { entityId: c.id, name: `tipo${i}`, amount: 1 });
    }
    executar(m, 'INTENT_ADD_COUNTER', 'a', { entityId: c.id, name: 'mais-um', amount: 1 });
    executar(m, 'INTENT_SET_COUNTER', 'a', { entityId: c.id, name: 'outro', value: 3 });
    executar(m, 'INTENT_BATCH_COUNTER', 'a', { entityIds: [c.id], name: 'lote', amount: 1 });
    expect(c.counters.size).toBe(LIMITES_DA_MESA.CONTADORES_POR_CARTA);
    expect(erros(m).map((e) => e.intent)).toEqual([
      'INTENT_ADD_COUNTER',
      'INTENT_SET_COUNTER',
      'INTENT_BATCH_COUNTER',
    ]);

    executar(m, 'INTENT_ADD_COUNTER', 'a', { entityId: c.id, name: 'tipo0', amount: 2 });
    expect(c.counters.get('tipo0')).toBe(3);
  });

  it('no máximo 64 setas por jogador — apagar uma continua funcionando', () => {
    const m = mesa(['a', 'b']);
    const origem = poe(m.state, 'a', 'BATTLEFIELD');
    const alvos = Array.from({ length: 65 }, () => poe(m.state, 'b', 'BATTLEFIELD'));
    for (const alvo of alvos)
      executar(m, 'INTENT_ARROW', 'a', { fromId: origem.id, toId: alvo.id });
    expect(m.state.arrows.size).toBe(LIMITES_DA_MESA.SETAS_POR_JOGADOR);
    expect(erros(m)[0]).toMatchObject({ code: 'LIMIT', intent: 'INTENT_ARROW' });

    executar(m, 'INTENT_ARROW', 'a', { fromId: origem.id, toId: alvos[0]!.id });
    expect(m.state.arrows.size).toBe(LIMITES_DA_MESA.SETAS_POR_JOGADOR - 1);
  });

  it('o schema da ficha e o da revelação têm teto', () => {
    const ficha = { amount: 1, x: 0, y: 0 };
    expect(S.CreateTokenIntent.safeParse({ ...ficha, scryfallId: 'nao-e-uuid' }).success).toBe(
      false,
    );
    expect(S.CreateTokenIntent.safeParse({ ...ficha, name: 'x'.repeat(121) }).success).toBe(false);
    expect(S.CreateTokenIntent.safeParse({ ...ficha, power: '12345' }).success).toBe(false);
    expect(S.CreateTokenIntent.safeParse({ ...ficha, power: '1+*', toughness: '*' }).success).toBe(
      true,
    );
    expect(S.RevealIntent.safeParse({ ids: [U(1)], to: ['x'.repeat(65)] }).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  M1 — votação de remoção
// ═══════════════════════════════════════════════════════════════════════════

describe('votação de remoção (M1)', () => {
  /** O segundo jogador de uma mesa de dois tirava o anfitrião com um clique. */
  it('numa mesa de dois, a votação nem abre — quem remove é o anfitrião', () => {
    const m = mesa(['a', 'b']);
    executar(m, 'INTENT_VOTE_KICK', 'b', { playerId: 'a', aceitar: true });
    expect(m.expulsos).toEqual([]);
    expect(m.state.votacaoAlvo).toBe('');
    expect(erros(m)[0]).toMatchObject({ code: 'INVALID_PAYLOAD', intent: 'INTENT_VOTE_KICK' });
  });

  it('se a votação fica com um votante só, ela não conclui', () => {
    const m = mesa(['a', 'b', 'c']);
    executar(m, 'INTENT_VOTE_KICK', 'a', { playerId: 'c', aceitar: true });
    m.state.players.get('b')!.connected = false;
    executar(m, 'INTENT_VOTE_KICK', 'a', { playerId: 'c', aceitar: true });
    expect(m.expulsos).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Só quem está na mesa age nela
// ═══════════════════════════════════════════════════════════════════════════

describe('barreiraDoRemetente', () => {
  it('jogador passa; plateia só no chat; quem não é nenhum dos dois, em nada', () => {
    const state = montarMesa(['a']);
    state.espectadores.set('olheiro', new Espectador());
    expect(barreiraDoRemetente(state, 'a', 'INTENT_DRAW')).toBeNull();
    expect(barreiraDoRemetente(state, 'olheiro', 'INTENT_CHAT')).toBeNull();
    expect(barreiraDoRemetente(state, 'olheiro', 'INTENT_DRAW')).toBe('SPECTATOR');
    expect(barreiraDoRemetente(state, 'aba-antiga', 'INTENT_CHAT')).toBe('SEM_ASSENTO');
  });
});
