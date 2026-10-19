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

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { MatchesService } from './matches.service.js';
import { AUDIENCIA_DA_VOZ } from '../auth/passe-de-mesa.js';

interface Carta {
  scryfallId: string;
  boardType: string;
  quantity?: number;
  isBanned?: boolean;
  name?: string;
}

interface Deck {
  formatId: string;
  cardCount: number;
  cards: Carta[];
}

function montarServico(deck: Deck) {
  const decksService = { getDeckById: jest.fn().mockResolvedValue(deck) };
  const jwtService = { sign: jest.fn().mockReturnValue('token-falso') };
  /**
   * Todos os interruptores LIGADOS.
   *
   * `createMatch` e `getVoiceToken` passaram a consultar `platform_flags`
   * (DOC-061 §5). O que estes testes verificam é a validação de deck, e um
   * duplo que devolvesse `false` faria todos eles falharem por um motivo que
   * não é o assunto deles.
   */
  const sistema = { flagLigada: jest.fn().mockResolvedValue(true) };

  return new MatchesService(
    jwtService as unknown as ConstructorParameters<typeof MatchesService>[0],
    // O Prisma entrou no construtor por causa de `registrarResumo`, que e a
    // primeira coisa deste servico a escrever no banco. Nenhum teste deste
    // arquivo o exercita — eles sao sobre validacao de deck e assinatura de
    // config — entao o duplo e vazio de proposito: se algum caminho testado
    // passar a tocar o banco, ele falha alto em vez de gravar em silencio.
    {} as unknown as ConstructorParameters<typeof MatchesService>[1],
    decksService as unknown as ConstructorParameters<typeof MatchesService>[2],
    sistema as unknown as ConstructorParameters<typeof MatchesService>[3],
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

  /**
   * A hidratação é o que traz `isBanned`. Ela era opcional: com a Scryfall
   * fora do ar, o deck voltava com toda carta "legal" e entrava na mesa com
   * banida e tudo.
   */
  it('exige a hidratação: sem a Scryfall, a entrada é recusada em vez de aprovada', async () => {
    const decksService = {
      getDeckById: jest
        .fn()
        .mockRejectedValue(new ServiceUnavailableException('Provedor de cartas indisponível.')),
    };
    const svc = new MatchesService(
      { sign: jest.fn() } as unknown as ConstructorParameters<typeof MatchesService>[0],
      {} as unknown as ConstructorParameters<typeof MatchesService>[1],
      decksService as unknown as ConstructorParameters<typeof MatchesService>[2],
      {} as unknown as ConstructorParameters<typeof MatchesService>[3],
    );

    await expect(entrar(svc)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(decksService.getDeckById).toHaveBeenCalledWith('u1', 'deck-1', {
      exigirHidratacao: true,
    });
  });

  it('a contagem é conferida ANTES do comandante', async () => {
    // Um deck de 40 cartas sem comandante erra nas duas coisas. A mensagem útil
    // é a do tamanho: é o problema maior e o que o jogador resolve primeiro.
    const svc = montarServico({ formatId: 'commander', cardCount: 40, cards: main(40) });
    await expect(entrar(svc)).rejects.toThrow(/exatamente 100/i);
  });
});

/**
 * ─── A CONFIGURAÇÃO DA SALA NÃO PODE VIR DO NAVEGADOR SEM ASSINATURA ───────
 *
 * As opções da sala eram escritas pelo cliente e o `onCreate` só as limitava
 * contra `REALTIME_LIMITS.MAX_PLAYERS`: dava para abrir uma mesa de Duel
 * Commander com oito assentos editando um número na querystring.
 *
 * A correção é um passe de configuração assinado por `createMatch` e devolvido
 * em `joinMatch`, que o embute no seat token. O que estes casos fixam é o que
 * torna esse passe útil: ele tem de estar VINCULADO À SALA, tem de ser
 * ignorado em silêncio quando não presta, e a configuração tem de sair dele já
 * dentro dos limites do formato.
 */
describe('configuração de sala', () => {
  /** Duplo de JWT que assina de verdade o suficiente para o teste ir e voltar. */
  function servicoComJwt() {
    const emitidos = new Map<string, object>();
    let contador = 0;

    const jwtService = {
      sign: jest.fn((payload: object) => {
        const token = `assinado-${(contador += 1)}`;
        emitidos.set(token, payload);
        return token;
      }),
      verify: jest.fn((token: string) => {
        const payload = emitidos.get(token);
        // Um passe que este serviço não emitiu é indistinguível de um forjado:
        // `jsonwebtoken` lança, e é isso que o duplo precisa reproduzir.
        if (!payload) throw new Error('invalid signature');
        return payload;
      }),
    };

    const svc = new MatchesService(
      jwtService as unknown as ConstructorParameters<typeof MatchesService>[0],
      {} as unknown as ConstructorParameters<typeof MatchesService>[1],
      { getDeckById: jest.fn() } as unknown as ConstructorParameters<typeof MatchesService>[2],
      {
        flagLigada: jest.fn().mockResolvedValue(true),
      } as unknown as ConstructorParameters<typeof MatchesService>[3],
    );

    /** As claims do seat token da última chamada a `joinMatch`. */
    const claimsDoPasse = (token: string) => emitidos.get(token) as Record<string, unknown>;

    return { svc, jwtService, claimsDoPasse };
  }

  it('createMatch sem corpo devolve a config padrão, e ela é PRIVADA', async () => {
    const { svc } = servicoComJwt();
    const { config } = await svc.createMatch('u1', 'gaspare');

    expect(config.visibilidade).toBe('PRIVADA');
    expect(config.gameType).toBe('commander');
  });

  it('createMatch aplica a faixa do FORMATO, não a do navegador', async () => {
    // Oito assentos numa mesa de Duel Commander era exatamente o buraco.
    const { svc } = servicoComJwt();
    const { config } = await svc.createMatch('u1', 'gaspare', {
      gameType: 'duel_commander',
      maxClients: 8,
    });

    expect(config.maxClients).toBe(2);
  });

  it('a config assinada volta para dentro do seat token', async () => {
    const { svc, claimsDoPasse } = servicoComJwt();
    const criada = await svc.createMatch('u1', 'gaspare', {
      nome: 'Mesa do Gaspare',
      visibilidade: 'PUBLICA',
      maxClients: 3,
    });

    const { seatToken } = await svc.joinMatch(
      'u1',
      'gaspare',
      criada.roomCode,
      undefined,
      criada.configToken,
    );

    expect(claimsDoPasse(seatToken).cfg).toMatchObject({
      nome: 'Mesa do Gaspare',
      visibilidade: 'PUBLICA',
      maxClients: 3,
    });
  });

  it('um passe de OUTRA sala é ignorado — senão ele ampliaria qualquer mesa', async () => {
    const { svc, claimsDoPasse } = servicoComJwt();
    const outra = await svc.createMatch('u1', 'gaspare', { maxClients: 8 });

    // Passe legítimo, sala errada.
    const { seatToken } = await svc.joinMatch(
      'u2',
      'convidado',
      'ABCDEF',
      undefined,
      outra.configToken,
    );

    expect(claimsDoPasse(seatToken).cfg).toBeUndefined();
  });

  it('passe forjado ou ausente não derruba a entrada — perde-se o reforço, nunca o assento', async () => {
    const { svc, claimsDoPasse } = servicoComJwt();

    const forjado = await svc.joinMatch('u2', 'convidado', 'ABCDEF', undefined, 'nao-sou-um-jwt');
    expect(claimsDoPasse(forjado.seatToken).cfg).toBeUndefined();
    expect(forjado.seatToken).toBeTruthy();

    // Quem entra pelo código nunca teve passe de configuração: é o caso comum.
    const semPasse = await svc.joinMatch('u3', 'outro', 'ABCDEF');
    expect(claimsDoPasse(semPasse.seatToken).cfg).toBeUndefined();
    expect(semPasse.seatToken).toBeTruthy();
  });

  it('renormaliza o que veio assinado: o catálogo pode ter mudado desde a emissão', async () => {
    const { svc, jwtService, claimsDoPasse } = servicoComJwt();

    // Simula um passe emitido por uma versão anterior, com uma configuração que
    // o catálogo de hoje não aceita mais.
    jwtService.verify.mockReturnValueOnce({
      roomId: 'ABCDEF',
      cfg: { gameType: 'duel_commander', maxClients: 8, nivelDePoder: 4 },
    });

    const { seatToken } = await svc.joinMatch('u1', 'gaspare', 'ABCDEF', undefined, 'passe-antigo');
    expect(claimsDoPasse(seatToken).cfg).toMatchObject({ maxClients: 2 });
  });
});

describe('getVoiceToken — a voz é de quem está na mesa', () => {
  /**
   * O passe de voz saía para qualquer conta e qualquer código, e a vitrine
   * pública lista os códigos: uma conta qualquer entrava no canal de voz de uma
   * mesa alheia. A primeira correção aceitava o seat token como prova — mas
   * `POST /join` emite um para QUALQUER código. A prova agora é o passe de voz
   * que o game-server assina depois de aceitar a entrada na sala.
   */
  const { JwtService } = jest.requireActual<typeof import('@nestjs/jwt')>('@nestjs/jwt');
  const jwt = new JwtService({ secret: 'segredo-de-teste-com-16+' });
  const sistema = { flagLigada: jest.fn().mockResolvedValue(true) };
  const svc = new MatchesService(
    jwt,
    {} as unknown as ConstructorParameters<typeof MatchesService>[1],
    {} as unknown as ConstructorParameters<typeof MatchesService>[2],
    sistema as unknown as ConstructorParameters<typeof MatchesService>[3],
  );
  const podePublicar = (token: string) =>
    (
      JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
        video: { canPublish: boolean };
      }
    ).video.canPublish;

  /** O passe como o game-server o assina — o contrato combinado entre os dois. */
  const passeDeVoz = (sub: string, roomId: string, spectator = false) =>
    jwt.sign(
      { sub, roomId, spectator },
      { audience: AUDIENCIA_DA_VOZ, algorithm: 'HS256', expiresIn: '6h' },
    );

  it('sem passe de voz, não há voz', async () => {
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123')).token).toBeNull();
  });

  it('o seat token não serve mais: a API o emite para qualquer código', async () => {
    const { seatToken } = await svc.joinMatch('u1', 'Ana', 'ABC123');
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', seatToken)).token).toBeNull();
    const plateia = svc.spectateMatch('u1', 'Ana', 'ABC123');
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', plateia.seatToken)).token).toBeNull();
  });

  it('passe de outra sala ou de outra conta não serve', async () => {
    const outraSala = passeDeVoz('u1', 'ZZZ999');
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', outraSala)).token).toBeNull();
    const outraConta = passeDeVoz('u2', 'ABC123');
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', outraConta)).token).toBeNull();
  });

  it('um access token comum, sem a audiência da voz, não serve', async () => {
    const sessao = jwt.sign({ sub: 'u1', roomId: 'ABC123' });
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', sessao)).token).toBeNull();
  });

  it('passe assinado com outro algoritmo não serve, mesmo com o segredo certo', async () => {
    const hs512 = jwt.sign(
      { sub: 'u1', roomId: 'ABC123', spectator: false },
      { audience: AUDIENCIA_DA_VOZ, algorithm: 'HS512' },
    );
    expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', hs512)).token).toBeNull();
  });

  it('quem assiste ouve, mas não fala', async () => {
    const { token } = await svc.getVoiceToken(
      'u1',
      'Ana',
      'ABC123',
      passeDeVoz('u1', 'ABC123', true),
    );
    expect(token).toBeTruthy();
    expect(podePublicar(token!)).toBe(false);
  });

  it('quem tem assento fala', async () => {
    const { token } = await svc.getVoiceToken('u1', 'Ana', 'ABC123', passeDeVoz('u1', 'ABC123'));
    expect(podePublicar(token!)).toBe(true);
  });

  /**
   * Em produção sem LiveKit configurado, a API assinava com a chave de exemplo
   * (`devkey`) e o navegador enchia o console de "invalid API key".
   */
  describe('em produção', () => {
    const ambiente = { ...process.env };
    afterEach(() => {
      process.env = { ...ambiente };
    });
    const assento = () => passeDeVoz('u1', 'ABC123');

    it('sem chave do LiveKit, a mesa fica sem voz em vez de receber passe inválido', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
      const r = await svc.getVoiceToken('u1', 'Ana', 'ABC123', assento());
      expect(r.token).toBeNull();
    });

    it('a chave de exemplo do servidor de desenvolvimento também não vale', async () => {
      process.env.NODE_ENV = 'production';
      process.env.LIVEKIT_API_KEY = 'devkey';
      process.env.LIVEKIT_API_SECRET = 'secret';
      expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', assento())).token).toBeNull();
    });

    it('com chave de verdade, a voz funciona', async () => {
      process.env.NODE_ENV = 'production';
      process.env.LIVEKIT_API_KEY = 'APIchaveDeVerdade';
      process.env.LIVEKIT_API_SECRET = 'segredo-de-verdade-com-tamanho';
      expect((await svc.getVoiceToken('u1', 'Ana', 'ABC123', assento())).token).toBeTruthy();
    });
  });
});

describe('registrarResumo — conta excluída não derruba o resumo', () => {
  it('grava só as contas que ainda existem', async () => {
    const criar = jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = {
      matchSummary: { findFirst: jest.fn().mockResolvedValue(null), create: criar },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u3' }]) },
    };
    const svc = new MatchesService(
      {} as unknown as ConstructorParameters<typeof MatchesService>[0],
      prisma as unknown as ConstructorParameters<typeof MatchesService>[1],
      {} as unknown as ConstructorParameters<typeof MatchesService>[2],
      {} as unknown as ConstructorParameters<typeof MatchesService>[3],
    );

    await svc.registrarResumo({
      roomCode: 'ABC123',
      playerCount: 3,
      durationSeconds: 600,
      participantes: ['u1', 'u2-excluida', 'u3'],
      // O zod completa `detalhes` com []: é o payload JÁ validado que chega aqui.
      detalhes: [],
    });

    const dados = criar.mock.calls[0][0].data.participants.createMany.data;
    // Cada linha agora leva também os detalhes do histórico (todos nulos aqui,
    // sem `detalhes`); a regra que este teste guarda é sobre QUAIS contas.
    expect(dados.map((d: { userId: string }) => d.userId)).toEqual(['u1', 'u3']);
  });
});

describe('histórico de partidas (RN12, revista em 14/10/2026)', () => {
  function servico(prisma: object, decks: object = {}) {
    return new MatchesService(
      {} as unknown as ConstructorParameters<typeof MatchesService>[0],
      prisma as unknown as ConstructorParameters<typeof MatchesService>[1],
      decks as unknown as ConstructorParameters<typeof MatchesService>[2],
      {} as unknown as ConstructorParameters<typeof MatchesService>[3],
    );
  }

  it('grava a foto de cada participante e o bracket do deck no momento da partida', async () => {
    const criar = jest.fn().mockResolvedValue({ id: 'm1' });
    const svc = servico(
      {
        matchSummary: { findFirst: jest.fn().mockResolvedValue(null), create: criar },
        user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
      },
      {
        // Quatro Game Changers no deck do u1: bracket 4.
        getDeckById: jest.fn().mockResolvedValue({
          formatId: 'commander',
          cards: ['A', 'B', 'C', 'D'].map((name) => ({
            name,
            quantity: 1,
            boardType: 'MAIN',
            gameChanger: true,
          })),
        }),
      },
    );

    await svc.registrarResumo({
      roomCode: 'ABC123',
      playerCount: 2,
      durationSeconds: 900,
      participantes: ['u1', 'u2'],
      formato: 'commander',
      turnos: 8,
      detalhes: [
        {
          userId: 'u1',
          assento: 0,
          deckId: '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f',
          nomeDoDeck: 'Dinos',
          comandanteId: 'sf-cmd',
          vidaFinal: 12,
          venceu: true,
          comecou: true,
        },
        { userId: 'u2', assento: 1, vidaFinal: 0, motivoDaEliminacao: 'LIFE', saiuAntes: false },
      ],
    });

    const { data } = criar.mock.calls[0][0];
    expect(data).toMatchObject({ format: 'commander', turns: 8 });
    const [u1, u2] = data.participants.createMany.data;
    expect(u1).toMatchObject({
      userId: 'u1',
      won: true,
      startedFirst: true,
      bracket: 4,
      finalLife: 12,
    });
    expect(u2).toMatchObject({
      userId: 'u2',
      won: false,
      eliminationReason: 'LIFE',
      bracket: null,
    });
  });

  it('lista as partidas com o resultado de quem pede, e "Conta excluída" no lugar do nome apagado', async () => {
    const partida = {
      id: 'm1',
      endedAt: new Date('2026-10-11T21:37:00Z'),
      durationSeconds: 1500,
      format: 'commander',
      turns: 8,
      playerCount: 2,
      participants: [
        {
          userId: 'eu',
          seat: 0,
          deckId: 'd1',
          deckName: 'Elfos',
          commanderId: 'c1',
          bracket: 3,
          finalLife: 0,
          won: false,
          startedFirst: false,
          leftEarly: false,
          eliminationReason: 'LIFE',
          user: { username: 'gaspare', displayName: null },
        },
        {
          userId: null,
          seat: 1,
          deckId: 'd2',
          deckName: 'Vermes',
          commanderId: 'c2',
          bracket: 1,
          finalLife: 30,
          won: true,
          startedFirst: true,
          leftEarly: false,
          eliminationReason: null,
          user: null,
        },
      ],
    };
    const svc = servico({
      matchSummary: { count: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([1, [partida]]),
    });

    const r = await svc.historico('eu', { resultado: 'todas', pagina: 1 });

    expect(r.partidas[0]!.resultado).toBe('DERROTA');
    const [eu, outro] = r.partidas[0]!.participantes;
    expect(eu).toMatchObject({ souEu: true, deckId: 'd1', nome: 'gaspare' });
    // O id do deck alheio não sai: só o dono abre o próprio deck.
    expect(outro).toMatchObject({
      souEu: false,
      deckId: null,
      nome: 'Conta excluída',
      venceu: true,
    });
  });

  it('estatísticas: vitórias, taxa, duração média e comandante mais jogado', async () => {
    const svc = servico({
      matchParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { won: true, commanderId: 'c1', match: { durationSeconds: 600 } },
          { won: false, commanderId: 'c1', match: { durationSeconds: 1200 } },
          { won: false, commanderId: 'c2', match: { durationSeconds: 1800 } },
          { won: false, commanderId: null, match: { durationSeconds: 600 } },
        ]),
      },
    });

    const e = await svc.estatisticasDoHistorico('eu');

    expect(e).toEqual({
      partidas: 4,
      vitorias: 1,
      taxaDeVitoria: 0.25,
      duracaoMediaSegundos: 1050,
      comandanteMaisJogado: { comandanteId: 'c1', partidas: 2 },
    });
  });
});
