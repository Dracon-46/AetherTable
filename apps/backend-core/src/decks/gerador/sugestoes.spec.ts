/**
 * sugestoes.spec.ts — cartas recomendadas a partir do comandante do deck.
 *
 * O que estes casos fixam:
 *
 *   - o que o deck já tem (em qualquer impressão) não volta como sugestão;
 *   - a busca é na identidade do comandante, e o tema dele vira um grupo;
 *   - deck sem comandante não gasta busca nenhuma;
 *   - deck de outra conta é 404.
 */

import { NotFoundException } from '@nestjs/common';
import { filtrarSugestoes, SugestoesDeCartasService } from './sugestoes.service.js';
import type { Candidata } from './montagem.js';

const carta = (id: string, extra: Partial<Candidata> = {}): Candidata => ({
  id,
  oracle_id: `o-${id}`,
  name: `Carta ${id}`,
  type_line: 'Artifact',
  mana_cost: '{2}',
  ...extra,
});

describe('filtrarSugestoes', () => {
  it('pula o que o deck já tem, por oracle_id, e respeita o teto', () => {
    const candidatas = [carta('a'), carta('b'), carta('c'), carta('d')];
    const saida = filtrarSugestoes(candidatas, new Set(['o-b']), 2);
    expect(saida.map((c) => c.scryfallId)).toEqual(['a', 'c']);
  });

  it('outra impressão da mesma carta não aparece duas vezes', () => {
    const saida = filtrarSugestoes(
      [carta('a1', { oracle_id: 'o-sol' }), carta('a2', { oracle_id: 'o-sol' })],
      new Set(),
    );
    expect(saida).toHaveLength(1);
  });

  it('marca Game Changer', () => {
    expect(filtrarSugestoes([carta('x', { game_changer: true })], new Set())[0]).toMatchObject({
      gameChanger: true,
    });
  });
});

describe('SugestoesDeCartasService', () => {
  const GHALTA = carta('ghalta', {
    name: 'Ghalta, Primal Hunger',
    type_line: 'Legendary Creature — Elder Dinosaur',
    oracle_text: 'Trample',
    color_identity: ['G'],
  });
  const SOL = carta('sol', { name: 'Sol Ring', oracle_id: 'o-sol' });

  function montar(cartasDoDeck: Array<{ scryfallId: string; boardType: string }> | null) {
    const prisma = {
      deck: { findFirst: jest.fn().mockResolvedValue(cartasDoDeck && { cards: cartasDoDeck }) },
    };
    const cards = {
      collection: jest.fn().mockResolvedValue({ data: [GHALTA, SOL] }),
      search: jest.fn().mockResolvedValue({
        data: [SOL, carta('cultivate', { name: 'Cultivate' })],
      }),
    };
    const servico = new SugestoesDeCartasService(prisma as never, cards as never);
    return { servico, prisma, cards };
  }

  it('busca na identidade do comandante, com o tema dele, sem repetir o que o deck tem', async () => {
    const { servico, cards } = montar([
      { scryfallId: 'GHALTA', boardType: 'COMMANDER' },
      { scryfallId: 'sol', boardType: 'MAIN' },
    ]);
    const r = await servico.sugerir('u1', 'd1');

    expect(r.comandantes).toEqual(['Ghalta, Primal Hunger']);
    expect(r.temas).toContain('tribo Dinosaur');
    const consultas = cards.search.mock.calls.map((c) => c[0] as string);
    expect(consultas.every((q) => q.includes('id<=G'))).toBe(true);
    expect(consultas.some((q) => q.includes('t:dinosaur'))).toBe(true);
    expect(r.grupos[0]!.papel).toBe('tema');
    // Sol Ring já está no deck: só Cultivate sobra em cada grupo.
    for (const g of r.grupos) expect(g.cartas.map((c) => c.name)).toEqual(['Cultivate']);
  });

  it('sem comandante, nenhuma busca', async () => {
    const { servico, cards } = montar([{ scryfallId: 'sol', boardType: 'MAIN' }]);
    const r = await servico.sugerir('u1', 'd1');
    expect(r.grupos).toEqual([]);
    expect(cards.search).not.toHaveBeenCalled();
  });

  it('deck de outra conta é 404', async () => {
    const { servico } = montar(null);
    await expect(servico.sugerir('u1', 'd1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('busca sem resultado (404 da Scryfall) vira grupo vazio, não erro', async () => {
    const { servico, cards } = montar([{ scryfallId: 'ghalta', boardType: 'COMMANDER' }]);
    cards.search.mockRejectedValue(new NotFoundException());
    await expect(servico.sugerir('u1', 'd1')).resolves.toMatchObject({ grupos: [] });
  });
});
