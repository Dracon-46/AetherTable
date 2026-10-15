/**
 * cards.controller.spec.ts — a rota de busca.
 *
 * Busca que não acha nada é lista vazia com 200, e não o 404 da Scryfall
 * repassado: para quem chama, "nenhuma carta" não é erro. Outros erros da
 * Scryfall continuam subindo.
 */

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CardsController } from './cards.controller.js';

function montar(search: jest.Mock) {
  return new CardsController({ search } as never, {} as never);
}

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
