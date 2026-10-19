/**
 * passes.spec.ts — o que conta como passe de mesa (A1).
 *
 * O passe era verificado sem audiência e sem algoritmo fixo, com `roomId`,
 * `jti` e `sub` opcionais. O access token da API — mesmo segredo, sem nenhuma
 * dessas claims — passava como passe universal.
 */

import jwt from 'jsonwebtoken';
import {
  AUDIENCIA_DA_MESA,
  AUDIENCIA_DA_VOZ,
  RecusaDeEntrada,
  emitirPasseDeVoz,
  validarPasse,
} from './passes';

const SEGREDO = 'segredo-so-deste-teste-16+';

const completo = { sub: 'u1', username: 'Ana', roomId: 'ABC123' };
const assinar = (payload: object, opcoes: jwt.SignOptions = {}) =>
  jwt.sign(payload, SEGREDO, {
    audience: AUDIENCIA_DA_MESA,
    expiresIn: '1d',
    jwtid: 'j1',
    ...opcoes,
  });

const codigo = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RecusaDeEntrada ? e.codigo : `outro: ${String(e)}`;
  }
  return 'aceito';
};

describe('validarPasse', () => {
  it('aceita o passe que a API emite', () => {
    expect(validarPasse(assinar(completo), SEGREDO)).toEqual({ ...completo, jti: 'j1' });
  });

  it.each([
    [
      'sem audiência (o access token)',
      jwt.sign({ ...completo }, SEGREDO, { expiresIn: '1h', jwtid: 'j1' }),
    ],
    ['com a audiência da voz', assinar(completo, { audience: AUDIENCIA_DA_VOZ })],
    ['sem jti', jwt.sign(completo, SEGREDO, { audience: AUDIENCIA_DA_MESA, expiresIn: '1d' })],
    ['sem sub', assinar({ username: 'Ana', roomId: 'ABC123' })],
    ['sem roomId', assinar({ sub: 'u1', username: 'Ana' })],
    ['sem expiração', jwt.sign(completo, SEGREDO, { audience: AUDIENCIA_DA_MESA, jwtid: 'j1' })],
    ['assinado com HS512', assinar(completo, { algorithm: 'HS512' })],
    [
      'com outro segredo',
      jwt.sign(completo, 'outro-segredo-qualquer-16+', {
        audience: AUDIENCIA_DA_MESA,
        expiresIn: '1d',
        jwtid: 'j1',
      }),
    ],
    ['com deckId que não é uuid', assinar({ ...completo, deckId: '../../admin' })],
  ])('recusa passe %s', (_caso, token) => {
    expect(codigo(() => validarPasse(token, SEGREDO))).toBe('INVALID_TOKEN');
  });

  it('recusa o que nem é texto', () => {
    expect(codigo(() => validarPasse(undefined, SEGREDO))).toBe('INVALID_TOKEN');
    expect(codigo(() => validarPasse({ token: 'x' }, SEGREDO))).toBe('INVALID_TOKEN');
  });

  it('diz que expirou quando expirou', () => {
    expect(codigo(() => validarPasse(assinar(completo, { expiresIn: -10 }), SEGREDO))).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('carrega cfg, deckId e spectator, e nada além das claims conhecidas', () => {
    const deckId = '11111111-0000-4000-8000-000000000001';
    const claims = validarPasse(
      assinar({
        ...completo,
        deckId,
        cfg: { maxClients: 4 },
        spectator: true,
        sessionId: 'x',
        admin: true,
      }),
      SEGREDO,
    );
    expect(claims).toEqual({
      ...completo,
      jti: 'j1',
      deckId,
      cfg: { maxClients: 4 },
      spectator: true,
    });
  });
});

describe('emitirPasseDeVoz', () => {
  it('sai com a audiência da voz, a sala e o papel', () => {
    const token = emitirPasseDeVoz({ sub: 'u1', roomId: 'ABC123', spectator: true }, SEGREDO);
    const claims = jwt.verify(token, SEGREDO, {
      algorithms: ['HS256'],
      audience: AUDIENCIA_DA_VOZ,
    });
    expect(claims).toMatchObject({
      sub: 'u1',
      roomId: 'ABC123',
      spectator: true,
      jti: expect.any(String),
    });
  });

  it('dois passes seguidos não têm o mesmo jti', () => {
    const a = jwt.decode(emitirPasseDeVoz({ sub: 'u1', roomId: 'R', spectator: false }, SEGREDO));
    const b = jwt.decode(emitirPasseDeVoz({ sub: 'u1', roomId: 'R', spectator: false }, SEGREDO));
    expect((a as jwt.JwtPayload).jti).not.toBe((b as jwt.JwtPayload).jti);
  });
});
