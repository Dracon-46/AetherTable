/**
 * idioma.spec.ts — o deck inteiro num idioma.
 *
 * O que estes casos fixam: a busca é por LOTE de oracle_id (não uma por
 * carta) e pede o idioma; cada carta vai para a primeira impressão achada (a
 * mais recente); a que nunca saiu no idioma fica como está e volta listada; e
 * duas impressões da mesma carta que viram a mesma não quebram nada.
 */

import { DecksService } from './decks.service.js';

const linha = (id: string, scryfallId: string, boardType = 'MAIN', quantity = 1) => ({
  id,
  deckId: 'd1',
  scryfallId,
  boardType,
  quantity,
});

function montar() {
  const linhas = new Map(
    [
      linha('l1', 'sol-en'),
      linha('l2', 'bolt-en'),
      linha('l3', 'obscura-en'),
      linha('l4', 'sol-en-2', 'SIDEBOARD'),
    ].map((l) => [l.id, l]),
  );
  const tx = {
    deckCard: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ where, data }) => Object.assign(linhas.get(where.id)!, data)),
      delete: jest.fn(),
    },
  };
  const prisma = {
    deck: {
      findFirst: jest.fn().mockResolvedValue({ id: 'd1', cards: [...linhas.values()] }),
    },
    deckCard: { findUnique: jest.fn(async ({ where }) => linhas.get(where.id) ?? null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const cards = {
    collection: jest.fn().mockResolvedValue({
      data: [
        { id: 'sol-en', oracle_id: 'o-sol', name: 'Sol Ring', lang: 'en' },
        { id: 'sol-en-2', oracle_id: 'o-sol', name: 'Sol Ring', lang: 'en' },
        { id: 'bolt-en', oracle_id: 'o-bolt', name: 'Lightning Bolt', lang: 'en' },
        { id: 'obscura-en', oracle_id: 'o-obscura', name: 'Obscura', lang: 'en' },
      ],
    }),
    search: jest.fn().mockResolvedValue({
      data: [
        // Ordem de lançamento decrescente: a primeira de cada carta é a que vale.
        { id: 'SOL-PT-NOVA', oracle_id: 'o-sol', lang: 'pt' },
        { id: 'sol-pt-velha', oracle_id: 'o-sol', lang: 'pt' },
        { id: 'bolt-pt', oracle_id: 'o-bolt', lang: 'pt' },
      ],
    }),
  };
  const servico = new DecksService(prisma as never, cards as never);
  return { servico, cards, tx, linhas };
}

it('troca pela impressão mais recente no idioma, numa busca por lote', async () => {
  const { servico, cards, linhas } = montar();
  const r = await servico.trocarIdioma('u1', 'd1', 'pt');

  expect(cards.search).toHaveBeenCalledTimes(1);
  const [consulta, unique] = cards.search.mock.calls[0]!;
  expect(consulta).toMatch(
    /^lang:pt game:paper \(oracleid:o-sol or oracleid:o-bolt or oracleid:o-obscura\)$/,
  );
  expect(unique).toBe('prints');

  expect(linhas.get('l1')!.scryfallId).toBe('sol-pt-nova');
  expect(linhas.get('l2')!.scryfallId).toBe('bolt-pt');
  // A reserva também vai, no board dela.
  expect(linhas.get('l4')).toMatchObject({ scryfallId: 'sol-pt-nova', boardType: 'SIDEBOARD' });
  expect(r).toEqual({ trocadas: 3, semImpressao: ['Obscura'] });
});

it('deck vazio não gasta busca', async () => {
  const { servico, cards } = montar();
  const prisma = (servico as unknown as { prisma: { deck: { findFirst: jest.Mock } } }).prisma;
  prisma.deck.findFirst.mockResolvedValue({ id: 'd1', cards: [] });
  await expect(servico.trocarIdioma('u1', 'd1', 'pt')).resolves.toEqual({
    trocadas: 0,
    semImpressao: [],
  });
  expect(cards.search).not.toHaveBeenCalled();
});
