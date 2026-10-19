/**
 * jwt.strategy.spec.ts — o que a API aceita como sessão.
 *
 * ─── POR QUE ESTES TESTES EXISTEM ───────────────────────────────────────────
 *
 * Dois defeitos confirmados, e os dois deixavam alguém dentro da API sem ter
 * passado pelo login:
 *
 *  1. O seat token e o passe de espectador — assinados com o mesmo segredo e
 *     com `sub` — eram aceitos como sessão. O passe viaja na URL da mesa, que
 *     é colada no grupo: quem abrisse o link agia na API como o dono dele.
 *  2. Suspender e banir não derrubavam as sessões abertas, e a estratégia não
 *     olhava a situação da conta. A punição só valia no próximo login.
 *
 * Os passes são emitidos pelo `MatchesService` de verdade, com um `JwtService`
 * de verdade: um passe montado à mão no teste provaria só que o teste sabe
 * montar um passe, e não que o que a API emite é recusado.
 */

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy, type JwtPayload } from './jwt.strategy.js';
import type { RevogacaoService } from './revogacao.service.js';
import { MatchesService } from '../matches/matches.service.js';
import { AUDIENCIA_DA_MESA, AUDIENCIA_DA_VOZ } from './passe-de-mesa.js';
import { TAMANHO_MINIMO_DO_SEGREDO, segredoDoJwt } from './segredo-do-jwt.js';

const SEGREDO = 'segredo-de-teste-com-tamanho-suficiente';
const USUARIO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';

type Conta = {
  tokensValidosApos: Date | null;
  suspendedUntil: Date | null;
  deletedAt: Date | null;
} | null;

function montar(conta: Conta = { tokensValidosApos: null, suspendedUntil: null, deletedAt: null }) {
  const jwt = new JwtService({ secret: SEGREDO });
  const revogacao = {
    estaRevogado: jest.fn().mockResolvedValue(false),
    estadoDaConta: jest.fn().mockResolvedValue(conta),
  };
  const config = { get: () => SEGREDO } as unknown as ConfigService;
  const estrategia = new JwtStrategy(config, revogacao as unknown as RevogacaoService);

  const matches = new MatchesService(
    jwt,
    {} as never,
    { getDeckById: jest.fn() } as never,
    { flagLigada: jest.fn().mockResolvedValue(true) } as never,
  );

  /** O que o access token do login leva — ver `AuthService.login`. */
  const sessao = () =>
    jwt.verify<JwtPayload>(
      jwt.sign({ username: 'gaspare', sub: USUARIO }, { jwtid: 'abc', expiresIn: '1h' }),
    );

  return { jwt, estrategia, matches, revogacao, sessao };
}

describe('JwtStrategy — passe de mesa não é sessão da API', () => {
  it('recusa o seat token emitido por joinMatch', async () => {
    const { jwt, estrategia, matches } = montar();
    const { seatToken } = await matches.joinMatch(USUARIO, 'gaspare', 'ABC123');

    // Decodificado como o passport-jwt faz: assinatura e validade conferidas.
    const payload = jwt.verify<JwtPayload>(seatToken);
    await expect(estrategia.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa o passe de espectador', async () => {
    const { jwt, estrategia, matches } = montar();
    const { seatToken } = matches.spectateMatch(USUARIO, 'gaspare', 'ABC123');
    await expect(estrategia.validate(jwt.verify(seatToken))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa o passe de mesa emitido ANTES da audiência — ele ainda vive por um dia', async () => {
    // Sem `aud`, mas com `roomId`: é a forma do passe que já está na URL de
    // alguém no momento do deploy.
    const { jwt, estrategia } = montar();
    const antigo = jwt.sign(
      { sub: USUARIO, username: 'gaspare', roomId: 'ABC123' },
      { jwtid: 'x', expiresIn: '1d' },
    );
    await expect(estrategia.validate(jwt.verify(antigo))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('o passe sai com a audiência da mesa', async () => {
    const { jwt, matches } = montar();
    const { seatToken } = await matches.joinMatch(USUARIO, 'gaspare', 'ABC123');
    expect(jwt.decode<{ aud?: string }>(seatToken).aud).toBe(AUDIENCIA_DA_MESA);
  });

  it('o game-server continua aceitando o passe — verify sem `audience` não confere `aud`', async () => {
    // `AetherRoom.onAuth` faz `jwt.verify(seatToken, JWT_SECRET)` sem opção de
    // audiência. Se a claim nova quebrasse isso, ninguém mais sentaria à mesa.
    const { jwt, matches } = montar();
    const { seatToken } = await matches.joinMatch(USUARIO, 'gaspare', 'ABC123');
    expect(jwt.verify<{ roomId: string }>(seatToken).roomId).toBe('ABC123');
  });

  it('o access token do login continua passando', async () => {
    const { estrategia, sessao } = montar();
    await expect(estrategia.validate(sessao())).resolves.toMatchObject({
      sub: USUARIO,
      username: 'gaspare',
    });
  });
});

describe('JwtStrategy — a situação da conta vale em toda requisição', () => {
  it('recusa a sessão de uma conta suspensa', async () => {
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { estrategia, sessao } = montar({
      tokensValidosApos: null,
      suspendedUntil: amanha,
      deletedAt: null,
    });
    await expect(estrategia.validate(sessao())).rejects.toThrow(/suspensa/i);
  });

  it('suspensão vencida não bloqueia nada', async () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { estrategia, sessao } = montar({
      tokensValidosApos: null,
      suspendedUntil: ontem,
      deletedAt: null,
    });
    await expect(estrategia.validate(sessao())).resolves.toBeDefined();
  });

  it('recusa a sessão de uma conta banida', async () => {
    const { estrategia, sessao } = montar({
      tokensValidosApos: null,
      suspendedUntil: null,
      deletedAt: new Date(),
    });
    await expect(estrategia.validate(sessao())).rejects.toThrow(/encerrada/i);
  });

  it('recusa a sessão de uma conta que não existe mais', async () => {
    const { estrategia, sessao } = montar(null);
    await expect(estrategia.validate(sessao())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa o token emitido antes do corte de sessão', async () => {
    const { estrategia, sessao } = montar({
      // O corte está no futuro em relação ao `iat`: o token é anterior a ele.
      tokensValidosApos: new Date(Date.now() + 60_000),
      suspendedUntil: null,
      deletedAt: null,
    });
    await expect(estrategia.validate(sessao())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('JwtStrategy — passe de voz não é sessão', () => {
  it('recusa o passe de voz que o game-server assina', async () => {
    const { jwt, estrategia } = montar();
    // Exatamente como o game-server o emite (ver `AUDIENCIA_DA_VOZ`).
    const passe = jwt.sign(
      { sub: USUARIO, roomId: 'ABC123', spectator: false },
      { audience: AUDIENCIA_DA_VOZ, algorithm: 'HS256', expiresIn: '6h' },
    );
    await expect(
      estrategia.validate(jwt.verify(passe, { audience: AUDIENCIA_DA_VOZ })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

/**
 * Nenhum `verify` fixava o algoritmo: o `jsonwebtoken` aceitava o que o
 * cabeçalho do token declarasse. A estratégia agora só aceita HS256. O teste
 * passa pelo `authenticate` do Passport de verdade, que é onde a assinatura é
 * conferida — `validate` só vê o payload já aceito.
 */
describe('JwtStrategy — só HS256', () => {
  const autenticar = (estrategia: JwtStrategy, token: string) =>
    new Promise<'aceito' | 'recusado'>((resolve) => {
      const passaporte = estrategia as unknown as {
        success: () => void;
        fail: () => void;
        error: () => void;
        authenticate: (req: object) => void;
      };
      passaporte.success = () => resolve('aceito');
      passaporte.fail = () => resolve('recusado');
      passaporte.error = () => resolve('recusado');
      passaporte.authenticate({ headers: { authorization: `Bearer ${token}` } });
    });

  it('a sessão HS256 passa', async () => {
    const { jwt, estrategia } = montar();
    const token = jwt.sign({ username: 'gaspare', sub: USUARIO }, { algorithm: 'HS256' });
    await expect(autenticar(estrategia, token)).resolves.toBe('aceito');
  });

  it('a mesma sessão assinada em HS512, com o segredo certo, é recusada', async () => {
    const { jwt, estrategia } = montar();
    const token = jwt.sign({ username: 'gaspare', sub: USUARIO }, { algorithm: 'HS512' });
    await expect(autenticar(estrategia, token)).resolves.toBe('recusado');
  });
});

describe('segredoDoJwt — segredo curto não sobe em produção', () => {
  const leitor = (valores: Record<string, string | undefined>) => ({
    get: <T = string>(chave: string) => valores[chave] as T | undefined,
  });

  it('em produção, menos de 32 caracteres derruba o boot', () => {
    expect(() =>
      segredoDoJwt(leitor({ NODE_ENV: 'production', JWT_SECRET: 'curto-demais' })),
    ).toThrow(/32 caracteres/);
    expect(() => segredoDoJwt(leitor({ NODE_ENV: 'production' }))).toThrow(/32 caracteres/);
  });

  it(`em produção, ${TAMANHO_MINIMO_DO_SEGREDO} caracteres passam`, () => {
    const segredo = 'x'.repeat(TAMANHO_MINIMO_DO_SEGREDO);
    expect(segredoDoJwt(leitor({ NODE_ENV: 'production', JWT_SECRET: segredo }))).toBe(segredo);
  });

  it('fora de produção, segue como antes', () => {
    expect(segredoDoJwt(leitor({ NODE_ENV: 'development', JWT_SECRET: 'dev' }))).toBe('dev');
  });
});
