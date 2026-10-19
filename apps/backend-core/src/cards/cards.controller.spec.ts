/**
 * cards.controller.spec.ts — a rota de busca.
 *
 * Busca que não acha nada é lista vazia com 200, e não o 404 da Scryfall
 * repassado: para quem chama, "nenhuma carta" não é erro. Outros erros da
 * Scryfall continuam subindo.
 */

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { pendingCount } from '@aethertable/scryfall-client';
import { CardsController, FILA_MAXIMA_DA_SCRYFALL } from './cards.controller.js';

/** O tamanho da fila da Scryfall é do cliente real; aqui ele é controlado. */
jest.mock('@aethertable/scryfall-client', () => ({
  ...jest.requireActual<object>('@aethertable/scryfall-client'),
  pendingCount: jest.fn(() => 0),
}));
const fila = pendingCount as jest.Mock;

function montar(search: jest.Mock) {
  return new CardsController({ search } as never, {} as never);
}

beforeEach(() => {
  fila.mockReturnValue(0);
});

it('sem resultado: 200 com lista vazia', async () => {
  const c = montar(jest.fn().mockRejectedValue(new NotFoundException()));
  await expect(c.search('t:creature c=r kw:deathtouch')).resolves.toEqual({
    object: 'list',
    total_cards: 0,
    has_more: false,
    data: [],
  });
});

it('com resultado: devolve o que a Scryfall mandou', async () => {
  const lista = { object: 'list', total_cards: 1, has_more: false, data: [{ id: 'x' }] };
  const c = montar(jest.fn().mockResolvedValue(lista));
  await expect(c.search('sol ring')).resolves.toBe(lista);
});

it('outro erro (Scryfall fora do ar) continua sendo erro', async () => {
  const c = montar(jest.fn().mockRejectedValue(new ServiceUnavailableException()));
  await expect(c.search('sol ring')).rejects.toBeInstanceOf(ServiceUnavailableException);
});

/**
 * A fila da Scryfall é UMA para o servidor inteiro, e estas rotas são
 * públicas: vinte IPs dentro do próprio limite empilhavam centenas de buscas
 * na frente da hidratação do deck de quem estava entrando na mesa.
 */
describe('fila da Scryfall saturada', () => {
  const servico = {
    search: jest.fn().mockResolvedValue({ data: [] }),
    autocomplete: jest.fn().mockResolvedValue([]),
    collection: jest.fn().mockResolvedValue({ data: [], not_found: [] }),
  };
  const c = new CardsController(servico as never, {} as never);

  it(`acima de ${FILA_MAXIMA_DA_SCRYFALL} na fila, busca, autocomplete e collection são 503`, () => {
    fila.mockReturnValue(FILA_MAXIMA_DA_SCRYFALL + 1);

    // O 503 sai antes de qualquer coisa entrar na fila.
    expect(() => c.autocomplete('sol')).toThrow(ServiceUnavailableException);
    expect(() => c.collection({ identifiers: [{ name: 'Sol Ring' }] })).toThrow(
      'Muitas buscas agora; tente em instantes.',
    );
    expect(servico.autocomplete).not.toHaveBeenCalled();
    expect(servico.collection).not.toHaveBeenCalled();
  });

  it('a busca também', async () => {
    fila.mockReturnValue(FILA_MAXIMA_DA_SCRYFALL + 1);
    await expect(c.search('sol ring')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(servico.search).not.toHaveBeenCalled();
  });

  it('no limite, ainda entra', async () => {
    fila.mockReturnValue(FILA_MAXIMA_DA_SCRYFALL);
    await expect(c.search('sol ring')).resolves.toEqual({ data: [] });
  });
});
