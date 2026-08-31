/**
 * catalog.spec.ts — o catálogo é o que dá nome às cartas na mesa. Estes testes
 * fixam as três decisões que não são óbvias no código:
 *
 *  1. quando uma carta tem verso JOGÁVEL (e portanto `INTENT_TRANSFORM` deve
 *     mostrar outra imagem) e quando as duas faces são só uma arte;
 *  2. que a hidratação agrupa pedidos em vez de disparar uma requisição por
 *     carta — a Scryfall bloqueia quem não respeita isso;
 *  3. que um id desconhecido entra numa denylist e não é pedido para sempre.
 */

import { useCardCatalog } from './catalog';

const respostas: unknown[] = [];
let chamadas = 0;

beforeEach(() => {
  chamadas = 0;
  respostas.length = 0;
  useCardCatalog.setState({ cartas: {}, ausentes: {}, carregando: false });
  global.fetch = jest.fn(async () => {
    chamadas += 1;
    const corpo = respostas.shift() ?? { data: [], not_found: [] };
    return { ok: true, status: 200, json: async () => corpo } as Response;
  }) as unknown as typeof fetch;
});

const esperarFila = () => new Promise((r) => setTimeout(r, 300));

const CARTA_NORMAL = {
  id: 'aaa',
  name: 'Sol Ring',
  type_line: 'Artifact',
  mana_cost: '{1}',
  oracle_text: 'Tap: Add two colorless.',
  cmc: 1,
  color_identity: [],
  layout: 'normal',
  set: 'cmr',
  collector_number: '1',
  image_uris: { normal: 'u' },
};

const CARTA_DFC = {
  id: 'bbb',
  name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform',
  cmc: 1,
  color_identity: ['U'],
  set: 'isd',
  collector_number: '51',
  card_faces: [
    {
      name: 'Delver of Secrets',
      type_line: 'Creature — Human Wizard',
      power: '1',
      toughness: '1',
      image_uris: { normal: 'f' },
    },
    {
      name: 'Insectile Aberration',
      type_line: 'Creature — Human Insect',
      power: '3',
      toughness: '2',
      image_uris: { normal: 'b' },
    },
  ],
};

const CARTA_SPLIT = {
  id: 'ccc',
  name: 'Fire // Ice',
  layout: 'split',
  cmc: 2,
  color_identity: ['R', 'U'],
  set: 'apc',
  collector_number: '128',
  image_uris: { normal: 'u' },
  card_faces: [
    { name: 'Fire', type_line: 'Instant' },
    { name: 'Ice', type_line: 'Instant' },
  ],
};

describe('catálogo de cartas', () => {
  it('normaliza uma carta de face única', async () => {
    respostas.push({ data: [CARTA_NORMAL], not_found: [] });
    useCardCatalog.getState().hidratar(['aaa']);
    await esperarFila();

    const meta = useCardCatalog.getState().cartas.aaa;
    expect(meta?.name).toBe('Sol Ring');
    expect(meta?.typeLine).toBe('Artifact');
    expect(meta?.temVerso).toBe(false);
  });

  it('marca verso jogável em carta de dupla face', async () => {
    respostas.push({ data: [CARTA_DFC], not_found: [] });
    useCardCatalog.getState().hidratar(['bbb']);
    await esperarFila();

    const meta = useCardCatalog.getState().cartas.bbb;
    expect(meta?.temVerso).toBe(true);
    expect(meta?.faces).toHaveLength(2);
    expect(meta?.faces[1]?.name).toBe('Insectile Aberration');
    // O P/T da FRENTE é o que vale antes de transformar.
    expect(meta?.power).toBe('1');
  });

  it('NÃO marca verso em split (duas faces, uma imagem só)', async () => {
    respostas.push({ data: [CARTA_SPLIT], not_found: [] });
    useCardCatalog.getState().hidratar(['ccc']);
    await esperarFila();

    // Virar uma carta split mostraria um 404 na CDN: ela não tem `back/`.
    expect(useCardCatalog.getState().cartas.ccc?.temVerso).toBe(false);
  });

  it('agrupa vários pedidos numa requisição só', async () => {
    respostas.push({ data: [CARTA_NORMAL, CARTA_DFC], not_found: [] });
    const { hidratar } = useCardCatalog.getState();
    hidratar(['aaa']);
    hidratar(['bbb']);
    hidratar(['aaa', 'bbb']);
    await esperarFila();

    expect(chamadas).toBe(1);
  });

  it('não repete pedido de carta já conhecida', async () => {
    respostas.push({ data: [CARTA_NORMAL], not_found: [] });
    useCardCatalog.getState().hidratar(['aaa']);
    await esperarFila();
    expect(chamadas).toBe(1);

    useCardCatalog.getState().hidratar(['aaa']);
    await esperarFila();
    expect(chamadas).toBe(1);
  });

  it('coloca id desconhecido numa denylist em vez de pedir para sempre', async () => {
    respostas.push({ data: [], not_found: [{ id: 'zzz' }] });
    useCardCatalog.getState().hidratar(['zzz']);
    await esperarFila();

    expect(useCardCatalog.getState().ausentes.zzz).toBe(true);

    useCardCatalog.getState().hidratar(['zzz']);
    await esperarFila();
    expect(chamadas).toBe(1);
  });

  it('ignora id vazio ou nulo', async () => {
    useCardCatalog.getState().hidratar([undefined, null, '']);
    await esperarFila();
    expect(chamadas).toBe(0);
  });
});
