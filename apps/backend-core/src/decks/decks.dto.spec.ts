/**
 * decks.dto.spec.ts — o que a borda das rotas de deck aceita.
 *
 * Dois defeitos confirmados:
 *
 *  - o `formatId` passava por `/^[a-z0-9-]+$/`, sem sublinhado, e os ids do
 *    catálogo têm sublinhado. Criar um deck de Duel Commander, Commander 1v1,
 *    Historic Brawl ou Tiny Leaders voltava 400 "Dados inválidos";
 *  - o `scryfallId` entrava com a caixa que viesse. Em maiúsculas ele virava
 *    uma segunda linha da mesma carta e escapava da trava de banidas.
 */

import { AdicionarCartaDto, AtualizarImpressaoDto, CriarDeckDto } from './decks.dto.js';

const SOL_RING = '6ad8011d-3471-4369-9d68-b264cc027487';

describe('CriarDeckDto — formatId validado contra o catálogo', () => {
  it.each(['duel_commander', 'commander_1v1', 'historic_brawl', 'tiny_leaders'])(
    'aceita "%s", que tem sublinhado',
    (formatId) => {
      expect(CriarDeckDto.safeParse({ name: 'Deck', formatId }).success).toBe(true);
    },
  );

  it('normaliza a caixa antes de conferir', () => {
    expect(CriarDeckDto.parse({ formatId: 'PAUPER' }).formatId).toBe('pauper');
  });

  it('recusa formato que não existe no catálogo — a regex deixava passar', () => {
    const r = CriarDeckDto.safeParse({ formatId: 'formato-inventado' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Formato desconhecido.');
  });

  it('formatId continua opcional', () => {
    expect(CriarDeckDto.safeParse({ name: 'Deck' }).success).toBe(true);
  });
});

describe('scryfallId entra em minúsculas', () => {
  it('ao adicionar carta', () => {
    expect(AdicionarCartaDto.parse({ scryfallId: SOL_RING.toUpperCase() }).scryfallId).toBe(
      SOL_RING,
    );
  });

  it('ao trocar a impressão', () => {
    expect(AtualizarImpressaoDto.parse({ scryfallId: SOL_RING.toUpperCase() }).scryfallId).toBe(
      SOL_RING,
    );
  });

  it('continua recusando o que não é UUID', () => {
    expect(AdicionarCartaDto.safeParse({ scryfallId: 'sol-ring' }).success).toBe(false);
  });
});
