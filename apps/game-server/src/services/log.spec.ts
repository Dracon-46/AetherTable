/**
 * log.spec.ts — o log é a auditoria de acesso da partida (DOC-041 §1.4).
 *
 * A regra que estes testes fixam é a única que, se quebrada, transforma a
 * ferramenta de transparência num vazamento: um `LogType` neutro cobre
 * exatamente as ações em zona oculta, e por isso NUNCA pode carregar a
 * identidade da carta.
 */

import { criarLog, logTrocaZonaPublica, logTrocaZonaOculta, logCompra } from './log';
import { NEUTRAL_LOG_TYPES } from '@aethertable/shared-types';

const ID = '0000aaaa-1111-2222-3333-444455556666';

describe('log — identidade de carta', () => {
  it('anexa o scryfallId numa troca de zona pública', () => {
    const e = logTrocaZonaPublica('p1', 'Gaspare', ID, 'BATTLEFIELD', 'GRAVEYARD');
    expect(e.type).toBe('ZONE_CHANGE');
    expect(e.scryfallId).toBe(ID);
    // O servidor não conhece nomes: manda o marcador e o id.
    expect(e.text).toContain('{Carta}');
  });

  it('omite o campo quando não há id (carta que o servidor não identificou)', () => {
    const e = logTrocaZonaPublica('p1', 'Gaspare', undefined, 'EXILE', 'GRAVEYARD');
    expect('scryfallId' in e).toBe(false);
  });

  it('a variante oculta nunca nomeia nem identifica', () => {
    const e = logTrocaZonaOculta('p1', 'Gaspare', 'HAND');
    expect(e.type).toBe('ZONE_CHANGE_HIDDEN');
    expect(e.scryfallId).toBeUndefined();
    expect(e.text).not.toContain('{Carta}');
  });

  it('a compra publica CONTAGEM, nunca identidade', () => {
    const e = logCompra('p1', 'Gaspare', 3);
    expect(e.type).toBe('DRAW');
    expect(e.scryfallId).toBeUndefined();
    expect(e.text).toContain('3');
  });

  it('RECUSA scryfallId em qualquer tipo neutro', () => {
    for (const tipo of NEUTRAL_LOG_TYPES) {
      expect(() => criarLog(tipo, 'p1', 'texto', ID)).toThrow(/tipo neutro/i);
    }
  });

  it('aceita scryfallId nos tipos públicos', () => {
    for (const tipo of ['ZONE_CHANGE', 'PLAY', 'TOKEN', 'COUNTER'] as const) {
      expect(() => criarLog(tipo, 'p1', 'texto', ID)).not.toThrow();
    }
  });
});
