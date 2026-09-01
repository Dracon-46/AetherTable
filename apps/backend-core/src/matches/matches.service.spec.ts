/**
 * matches.service.spec.ts — as travas de entrada na mesa.
 *
 * POR QUE ESTES TESTES EXISTEM
 *
 * `joinMatch` é o único ponto do sistema que ainda conhece o deck INTEIRO e o
 * formato ao mesmo tempo. Depois daqui só existe o `seatToken`: o game-server
 * recebe um id de deck e provisiona o que vier. Uma regra de formato que não
 * for verificada aqui não é verificada em lugar nenhum — e o sintoma aparece na
 * mesa, com todo mundo já sentado.
 *
 * Foi o que acontecia sem a trava de comandante: o deck de 100 cartas passava
 * na contagem, a partida abria, e a zona de comando ficava vazia. Imposto de
 * comandante e dano de comandante existiam na interface sem nada de onde sair.
 */

import { BadRequestException } from '@nestjs/common';
import { MatchesService } from './matches.service.js';

type Carta = { scryfallId: string; boardType: string; isBanned?: boolean; name?: string };

function montarServico(deck: { formatId: string; cardCount: number; cards: Carta[] }) {
  const decksService = { getDeckById: jest.fn().mockResolvedValue(deck) };
  const jwtService = { sign: jest.fn().mockReturnValue('token-falso') };

  return new MatchesService(
    jwtService as unknown as ConstructorParameters<typeof MatchesService>[0],
    decksService as unknown as ConstructorParameters<typeof MatchesService>[1],
  );
}

/** Deck de Commander válido: 99 do main + 1 comandante. */
function deckDeCommander(cards: Carta[] = []): Parameters<typeof montarServico>[0] {
  return {
    formatId: 'commander',
    cardCount: 100,
    cards: [
      { scryfallId: 'main-1', boardType: 'MAIN' },
      { scryfallId: 'cmd-1', boardType: 'COMMANDER' },
      ...cards,
    ],
  };
}

const entrar = (svc: MatchesService) => svc.joinMatch('u1', 'Arthur', 'ABC123', 'deck-1');

describe('joinMatch — trava de comandante', () => {
  it('deixa entrar quando o deck tem um comandante', async () => {
    await expect(entrar(montarServico(deckDeCommander()))).resolves.toMatchObject({
      roomCode: 'ABC123',
    });
  });

  it('recusa Commander sem nenhuma carta marcada como COMMANDER', async () => {
    const svc = montarServico({
      formatId: 'commander',
      cardCount: 100,
      cards: [{ scryfallId: 'main-1', boardType: 'MAIN' }],
    });

    await expect(entrar(svc)).rejects.toBeInstanceOf(BadRequestException);
    await expect(entrar(svc)).rejects.toThrow(/exige um comandante/i);
  });

  it('aceita dois comandantes — a dupla de parceiros é legal', async () => {
    const svc = montarServico(deckDeCommander([{ scryfallId: 'cmd-2', boardType: 'COMMANDER' }]));
    await expect(entrar(svc)).resolves.toBeDefined();
  });

  it('recusa três comandantes', async () => {
    const svc = montarServico(
      deckDeCommander([
        { scryfallId: 'cmd-2', boardType: 'COMMANDER' },
        { scryfallId: 'cmd-3', boardType: 'COMMANDER' },
      ]),
    );
    await expect(entrar(svc)).rejects.toThrow(/máximo é 2/i);
  });

  it('vale para brawl também', async () => {
    const svc = montarServico({
      formatId: 'brawl',
      cardCount: 60,
      cards: [{ scryfallId: 'main-1', boardType: 'MAIN' }],
    });
    await expect(entrar(svc)).rejects.toThrow(/exige um comandante/i);
  });

  it('NÃO se aplica a formatos sem comandante', async () => {
    // Um deck de Modern não tem — nem pode ter — carta marcada como COMMANDER.
    // Aplicar a trava aqui trancaria o formato inteiro fora da mesa.
    const svc = montarServico({
      formatId: 'modern',
      cardCount: 60,
      cards: [{ scryfallId: 'main-1', boardType: 'MAIN' }],
    });
    await expect(entrar(svc)).resolves.toBeDefined();
  });
});

describe('joinMatch — travas que já existiam', () => {
  it('recusa deck de Commander com contagem diferente de 100', async () => {
    const svc = montarServico({ ...deckDeCommander(), cardCount: 99 });
    await expect(entrar(svc)).rejects.toThrow(/exatamente 100/i);
  });

  it('recusa carta banida', async () => {
    const svc = montarServico(
      deckDeCommander([
        { scryfallId: 'ban-1', boardType: 'MAIN', isBanned: true, name: 'Black Lotus' },
      ]),
    );
    await expect(entrar(svc)).rejects.toThrow(/banidas.*Black Lotus/i);
  });

  it('a contagem é conferida ANTES do comandante', async () => {
    // Um deck de 40 cartas sem comandante erra nas duas coisas. A mensagem útil
    // é a do tamanho: é o problema maior e o que o jogador resolve primeiro.
    const svc = montarServico({ formatId: 'commander', cardCount: 40, cards: [] });
    await expect(entrar(svc)).rejects.toThrow(/exatamente 100/i);
  });
});
