/**
 * Perfil público — um username fora da regra não vira requisição.
 *
 * A página roda no servidor e montava a URL da API com o parâmetro cru:
 * `/u/..%2Fadmin` pedia outro caminho da API. Agora o que o backend recusaria
 * já termina em 404 aqui.
 */

import PublicProfilePage from './page';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const pagina = (username: string) => PublicProfilePage({ params: Promise.resolve({ username }) });

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'u1',
      username: 'ana',
      displayName: null,
      avatarUrl: null,
      role: 'USER',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  })) as unknown as typeof fetch;
});

describe('/u/[username]', () => {
  it.each(['../admin', '..%2Fadmin', 'a b', 'ab'])(
    '"%s" termina em 404 sem chamar a API',
    async (nome) => {
      await expect(pagina(nome)).rejects.toThrow();
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('um username válido busca o perfil, com o nome codificado', async () => {
    await pagina('ana');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/users\/ana$/),
      expect.anything(),
    );
  });
});
