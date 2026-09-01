import { CardImageService } from './card-image.service.js';

/**
 * card-image.service.spec.ts — o que precisa ficar fixo no espelho de imagens.
 *
 * Dois riscos moram aqui, e nenhum dos dois aparece em teste manual:
 *
 *  1. a rota monta uma URL a partir de entrada do cliente. Se a validacao
 *     afrouxar, ela vira open proxy — o servidor buscando qualquer endereco que
 *     mandarem, inclusive da rede interna do host;
 *  2. o primeiro render de uma mesa pede a mesma arte dezenas de vezes no mesmo
 *     milissegundo. Sem deduplicacao, sao dezenas de downloads e o cache so
 *     comeca a servir no segundo render.
 */

const UUID = '0dd0f3e2-3e0a-4b41-9a10-2f83e4d3b3f6';

describe('CardImageService.validar', () => {
  it('aceita um UUID com qualidade e face validas', () => {
    expect(CardImageService.validar(UUID, 'normal', 'back')).toEqual({
      id: UUID,
      qualidade: 'normal',
      face: 'back',
    });
  });

  it('assume frente em qualidade normal quando nao pedem nada', () => {
    expect(CardImageService.validar(UUID, undefined, undefined)).toEqual({
      id: UUID,
      qualidade: 'normal',
      face: 'front',
    });
  });

  it('recusa qualquer id que nao seja UUID', () => {
    // Cada um destes ja virou uma URL para a rede interna em algum proxy real.
    for (const id of [
      '../../etc/passwd',
      'http://169.254.169.254/latest/meta-data',
      'a/b',
      '',
      `${UUID}.jpg`,
    ]) {
      expect(CardImageService.validar(id, 'normal', 'front')).toBeNull();
    }
  });

  it('recusa qualidade e face fora da lista', () => {
    expect(CardImageService.validar(UUID, 'png', 'front')).toBeNull();
    expect(CardImageService.validar(UUID, 'normal', 'side')).toBeNull();
    expect(CardImageService.validar(UUID, '../normal', 'front')).toBeNull();
  });
});

describe('CardImageService.obter', () => {
  let servico: CardImageService;
  let chamadas: string[];

  beforeEach(() => {
    servico = new CardImageService();
    chamadas = [];
    global.fetch = jest.fn(async (url: unknown) => {
      chamadas.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/jpeg']]) as unknown as Headers,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  it('monta a URL da CDN com o particionamento por dois caracteres', async () => {
    await servico.obter(UUID, 'small', 'front');
    expect(chamadas[0]).toBe(`https://cards.scryfall.io/small/front/0/d/${UUID}.jpg`);
  });

  it('trinta Montanhas no mesmo render custam UM download', async () => {
    await Promise.all(Array.from({ length: 30 }, () => servico.obter(UUID, 'small', 'front')));
    expect(chamadas).toHaveLength(1);
  });

  it('serve do cache na segunda vez', async () => {
    await servico.obter(UUID, 'small', 'front');
    await servico.obter(UUID, 'small', 'front');
    expect(chamadas).toHaveLength(1);
  });

  it('separa frente e verso: sao artes diferentes sob o mesmo id', async () => {
    await servico.obter(UUID, 'small', 'front');
    await servico.obter(UUID, 'small', 'back');
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]).toContain('/back/');
  });

  it('nao repete um 404 — pedir o verso de carta comum e o caso normal disso', async () => {
    global.fetch = jest.fn(async () => {
      chamadas.push('404');
      return { ok: false, status: 404 } as unknown as Response;
    }) as unknown as typeof fetch;

    expect(await servico.obter(UUID, 'small', 'back')).toBeNull();
    expect(await servico.obter(UUID, 'small', 'back')).toBeNull();
    expect(chamadas).toHaveLength(1);
  });

  it('falha de rede NAO entra na denylist: o proximo render tenta de novo', async () => {
    let tentativas = 0;
    global.fetch = jest.fn(async () => {
      tentativas += 1;
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    expect(await servico.obter(UUID, 'small', 'front')).toBeNull();
    expect(await servico.obter(UUID, 'small', 'front')).toBeNull();
    expect(tentativas).toBe(2);
  });
});
