/**
 * login.spec.tsx — o que a tela de login faz com o que chega pela URL e com o
 * clique nos provedores.
 *
 *  - `?erro=` escolhe uma frase de um dicionário fechado. Indexar o dicionário
 *    direto deixava `?erro=__proto__` devolver o protótipo de `Object`, e
 *    desenhar um objeto derrubava a página inteira — um link bastava.
 *  - "Entrar com Google" deixa a marca que a captura do `#token=` exige no
 *    retorno (ver `lib/oauth.ts`). Sem ela, o login legítimo seria recusado.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './page';
import { useAuthStore } from '../store/auth.store';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
}));

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('./CenaDoDragao', () => ({
  CenaDoDragao: () => null,
  useDragao: () => ({
    fase: 'repouso',
    carregar: jest.fn(),
    relaxar: jest.fn(),
    cuspir: jest.fn(),
  }),
}));

const FRASE_GENERICA = 'Não foi possível concluir o login pelo provedor. Tente de novo.';

function respostaJson(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

function renderizar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ accessToken: null, user: null });
  global.fetch = jest.fn(async (url: string) =>
    String(url).endsWith('/auth/provedores')
      ? respostaJson({ google: true, discord: false })
      : respostaJson({}),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('tela de login → ?erro=', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    '?erro=%s mostra a frase genérica em vez de derrubar a página',
    async (codigo) => {
      window.history.replaceState(null, '', `/?erro=${codigo}`);

      renderizar();

      expect(await screen.findByText(FRASE_GENERICA)).toBeInTheDocument();
    },
  );

  it('um código conhecido continua com a frase dele', async () => {
    window.history.replaceState(null, '', '/?erro=recusado');

    renderizar();

    expect(await screen.findByText('Você cancelou a autorização no provedor.')).toBeInTheDocument();
  });
});

describe('tela de login → Entrar com Google', () => {
  it('grava a marca de início antes de sair para o provedor', async () => {
    // O jsdom não navega; o que importa aqui é a marca, gravada antes.
    jest.spyOn(console, 'error').mockImplementation(() => {});

    renderizar();
    fireEvent.click(await screen.findByText('Google'));

    const marca = Number(sessionStorage.getItem('aethertable:oauth-iniciado'));
    expect(Date.now() - marca).toBeLessThan(5_000);
  });
});
