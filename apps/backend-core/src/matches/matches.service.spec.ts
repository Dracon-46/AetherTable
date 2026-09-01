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
 * As fixtures montam decks REAIS, com o número certo de cartas. Não é
 * cerimônia: a validação de tamanho passou a somar `cards[].quantity` em vez de
 * ler `deck.cardCount`, então uma fixture que declarasse `cardCount: 100` com
 * duas cartas dentro estaria testando o mundo antigo.
 */

import { BadRequestException } from '@nestjs/common';
import { MatchesService } from './matches.service.js';

type Carta = {
  scryfallId: string;
  boardType: string;
  quantity?: number;
  isBanned?: boolean;
  name?: string;
};

type Deck = { formatId: string; cardCount: number; cards: Carta[] };

function montarServico(deck: Deck) {
  const decksService = { getDeckById: jest.fn().mockResolvedValue(deck) };
  const jwtService = { sign: jest.fn().mockReturnValue('token-falso') };

  return new MatchesService(
    jwtService as unknown as ConstructorParameters<typeof MatchesService>[0],
    decksService as unknown as ConstructorParameters<typeof MatchesService>[1],
  );
}

/** N cartas de main, cada uma com quantidade implícita de 1. */
const main = (n: number): Carta[] =>
  Array.from({ length: n }, (_, i) => ({ scryfallId: `main-${i}`, boardType: 'MAIN' }));

/** N comandantes na zona de comando. */
const comandantes = (n: number): Carta[] =>
  Array.from({ length: n }, (_, i) => ({ scryfallId: `cmd-${i}`, boardType: 'COMMANDER' }));

/**
 * Deck de Commander com exatamente 100 cartas contáveis.
 *
 * @param qtdComandantes quantos vão na zona de comando
 * @param extras cartas que NÃO entram na conta (reserva) ou que o teste precisa
 */
function commander(qtdComandantes = 1, extras: Carta[] = []): Deck {
  return {
    formatId: 'commander',
    cardCount: 100,
    cards: [...comandantes(qtdComandantes), ...main(100 - qtdComandantes), ...extras],
  };
}

const entrar = (svc: MatchesService) => svc.joinMatch('u1', 'Arthur', 'ABC123', 'deck-1');

describe('joinMatch — trava de comandante', () => {
  it('deixa entrar quando o deck tem um comandante', async () => {
    await expect(entrar(montarServico(commander(1)))).resolves.toMatchObject({
      roomCode: 'ABC123',
    });
  });

  it('recusa Commander sem nenhuma carta marcada como COMMANDER', async () => {
    // 100 cartas, todas no main: passa no tamanho e cai na trava de comandante.
    const svc = montarServico({ formatId: 'commander', cardCount: 100, cards: main(100) });

    await expect(entrar(svc)).rejects.toBeInstanceOf(BadRequestException);
    await expect(entrar(svc)).rejects.toThrow(/exige um comandante/i);
  });

  it('aceita dois comandantes — a dupla de parceiros é legal', async () => {
    await expect(entrar(montarServico(commander(2)))).resolves.toBeDefined();
  });

  it('recusa três comandantes', async () => {
    await expect(entrar(montarServico(commander(3)))).rejects.toThrow(/máximo é 2/i);
  });

  it('vale para brawl também', async () => {
    const svc = montarServico({ formatId: 'brawl', cardCount: 60, cards: main(60) });
    await expect(entrar(svc)).rejects.toThrow(/exige um comandante/i);
  });

  it('NÃO se aplica a formatos sem comandante', async () => {
    // Um deck de Modern não tem — nem pode ter — carta marcada como COMMANDER.
    // Aplicar a trava aqui trancaria o formato inteiro fora da mesa.
    const svc = montarServico({ formatId: 'modern', cardCount: 60, cards: main(60) });
    await expect(entrar(svc)).resolves.toBeDefined();
  });
});

describe('joinMatch — a contagem vem das cartas, não do contador', () => {
  // `cardCount` é desnormalizado e, fora do import, era atualizado num
  // statement separado e SEM transação. Bastava a segunda escrita falhar — o
  // Neon do plano gratuito autossuspende — para o contador divergir. A mesa
  // então recusava um deck correto dizendo "seu grimório possui 97 cartas"
  // enquanto o deckbuilder mostrava 100, e o jogador não tinha o que consertar.

  it('aceita o deck quando o contador está errado mas as cartas estão certas', async () => {
    const svc = montarServico({ ...commander(1), cardCount: 97 });
    await expect(entrar(svc)).resolves.toBeDefined();
  });

  it('recusa quando as cartas estão erradas mesmo com o contador certo', async () => {
    // O inverso importa igual: confiar no contador deixaria entrar deck ilegal.
    const svc = montarServico({
      formatId: 'commander',
      cardCount: 100,
      cards: [...comandantes(1), ...main(49)],
    });
    await expect(entrar(svc)).rejects.toThrow(/possui 50 cartas/i);
  });

  it('soma quantidade, não número de linhas', async () => {
    // 99 ilhas numa linha só contam 99, não 1.
    const svc = montarServico({
      formatId: 'commander',
      cardCount: 0,
      cards: [
        { scryfallId: 'cmd-1', boardType: 'COMMANDER', quantity: 1 },
        { scryfallId: 'ilha', boardType: 'MAIN', quantity: 99 },
      ],
    });
    await expect(entrar(svc)).resolves.toBeDefined();
  });

  it('reserva e maybeboard não entram na conta', async () => {
    const svc = montarServico(
      commander(1, [
        { scryfallId: 'res-1', boardType: 'SIDEBOARD', quantity: 15 },
        { scryfallId: 'talvez', boardType: 'MAYBEBOARD', quantity: 30 },
      ]),
    );
    await expect(entrar(svc)).resolves.toBeDefined();
  });

  it('carta sem quantity conta como 1 — é o default do schema', async () => {
    // As 100 cartas de `commander(1)` não declaram quantity. Se a soma
    // assumisse 0, o deck inteiro valeria zero e nada entraria na mesa.
    await expect(entrar(montarServico(commander(1)))).resolves.toBeDefined();
  });
});

describe('joinMatch — travas que já existiam', () => {
  it('recusa deck de Commander com contagem diferente de 100', async () => {
    const svc = montarServico({
      formatId: 'commander',
      cardCount: 99,
      cards: [...comandantes(1), ...main(98)],
    });
    await expect(entrar(svc)).rejects.toThrow(/exatamente 100/i);
  });

  it('recusa carta banida', async () => {
    const svc = montarServico({
      formatId: 'commander',
      cardCount: 100,
      cards: [
        ...comandantes(1),
        ...main(98),
        { scryfallId: 'ban-1', boardType: 'MAIN', isBanned: true, name: 'Black Lotus' },
      ],
    });
    await expect(entrar(svc)).rejects.toThrow(/banidas.*Black Lotus/i);
  });

  it('a contagem é conferida ANTES do comandante', async () => {
    // Um deck de 40 cartas sem comandante erra nas duas coisas. A mensagem útil
    // é a do tamanho: é o problema maior e o que o jogador resolve primeiro.
    const svc = montarServico({ formatId: 'commander', cardCount: 40, cards: main(40) });
    await expect(entrar(svc)).rejects.toThrow(/exatamente 100/i);
  });
});
