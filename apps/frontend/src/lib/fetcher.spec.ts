/**
 * fetcher.spec.ts — o 400 de validação diz QUAL campo e POR QUÊ.
 *
 * O `ZodValidationPipe` do backend responde `{ message: 'Dados inválidos.',
 * erros: [{ campo, erro }] }` e só o `message` era lido: toda recusa de
 * formulário aparecia como "Dados inválidos.", com a explicação do servidor
 * jogada fora no caminho.
 */

import { ApiError, api, mensagemDaApi, mensagemDoCorpoDeErro } from './fetcher';
import { useAuthStore } from '../store/auth.store';

/** O corpo exato que `apps/backend-core/src/common/zod-validation.pipe.ts` monta. */
const CORPO_DO_PIPE = {
  message: 'Dados inválidos.',
  erros: [
    { campo: 'username', erro: 'Use apenas letras, números, ponto, hífen ou underline' },
    { campo: 'displayName', erro: 'String must contain at least 1 character(s)' },
  ],
};

function resposta(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

describe('mensagemDoCorpoDeErro', () => {
  it('a primeira falha por campo vence a frase genérica', () => {
    expect(mensagemDoCorpoDeErro(CORPO_DO_PIPE)).toBe(
      'Nome de usuário: Use apenas letras, números, ponto, hífen ou underline',
    );
  });

  it('campo sem rótulo conhecido vai com o nome cru — melhor que nenhum', () => {
    expect(
      mensagemDoCorpoDeErro({
        message: 'Dados inválidos.',
        erros: [{ campo: 'preferenciasDeMesa.fatorCarta', erro: 'Expected number' }],
      }),
    ).toBe('preferenciasDeMesa.fatorCarta: Expected number');
  });

  it('erro do objeto inteiro (`(raiz)`) dispensa o prefixo de campo', () => {
    expect(
      mensagemDoCorpoDeErro({
        message: 'Dados inválidos.',
        erros: [{ campo: '(raiz)', erro: 'Nada para atualizar' }],
      }),
    ).toBe('Nada para atualizar');
  });

  it('sem `erros[]`, continua lendo o `message` — texto ou lista', () => {
    expect(mensagemDoCorpoDeErro({ message: 'Username já em uso' })).toBe('Username já em uso');
    expect(mensagemDoCorpoDeErro({ message: ['a', 'b'] })).toBe('a b');
    expect(mensagemDoCorpoDeErro({ message: 'Dados inválidos.', erros: [] })).toBe(
      'Dados inválidos.',
    );
  });

  it('corpo vazio, não-objeto ou sem nada útil devolve null', () => {
    expect(mensagemDoCorpoDeErro(null)).toBeNull();
    expect(mensagemDoCorpoDeErro('texto')).toBeNull();
    expect(mensagemDoCorpoDeErro({})).toBeNull();
  });
});

describe('api() diante de um 400 de validação', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 't', user: { id: 'u', username: 'u' } });
  });

  it('a mensagem do ApiError — e a da tela — é a do campo, não "Dados inválidos."', async () => {
    global.fetch = jest.fn(async () => resposta(400, CORPO_DO_PIPE)) as unknown as typeof fetch;

    const erro = await api('/users/me', { method: 'PATCH', body: { username: 'a b' } }).catch(
      (e: unknown) => e,
    );

    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(400);
    expect(mensagemDaApi(erro)).toBe(
      'Nome de usuário: Use apenas letras, números, ponto, hífen ou underline',
    );
  });

  it('corpo sem JSON cai na mensagem por status', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('vazio');
      },
    })) as unknown as typeof fetch;

    const erro = await api('/x').catch((e: unknown) => e);
    expect((erro as ApiError).message).toBe('A API respondeu 409.');
  });
});
