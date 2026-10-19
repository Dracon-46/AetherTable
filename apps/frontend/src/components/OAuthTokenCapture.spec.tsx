/**
 * OAuthTokenCapture.spec.tsx — "entrei com o Google e voltei para o login".
 *
 * O backend conclui o OAuth em `/dashboard#token=…`. Quem chega assim ainda não
 * tem sessão, e o `ProtectedRoute` do painel desviava para `/` antes de a
 * captura (que morava DENTRO dele) montar — o fragmento ficava para trás e o
 * login por provedor não funcionava para ninguém que estivesse deslogado.
 *
 * E, em desenvolvimento, a captura em si também falhava: o `ativo` local do
 * efeito era zerado pela remontagem do StrictMode e a resposta do `/users/me`
 * era descartada. Os testes rodam sob `<React.StrictMode>` por isso.
 *
 * E o `#token=` só vale se ESTA aba começou o login (a marca de
 * `lib/oauth.ts`): sem isso, um link com o token de outra conta abria a sessão
 * dela no navegador da vítima.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProtectedRoute from './ProtectedRoute';
import LoginPage from '../app/page';
import { useAuthStore } from '../store/auth.store';

const replace = jest.fn();
const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push, prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
}));

// O `lucide-react` é publicado como ESM e o jest não o transforma; ícone não
// participa de nada do que se testa aqui.
jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

// A cena do dragão é decoração animada; nada nela participa do login.
jest.mock('../app/CenaDoDragao', () => ({
  CenaDoDragao: () => null,
  useDragao: () => ({
    fase: 'repouso',
    carregar: jest.fn(),
    relaxar: jest.fn(),
    cuspir: jest.fn(),
  }),
}));

const USUARIO = { id: 'u-oauth', username: 'viajante', email: 'v@exemplo.com' };

function respostaJson(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

const MARCA = 'aethertable:oauth-iniciado';

function renderizarLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <React.StrictMode>
      <QueryClientProvider client={client}>
        <LoginPage />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

const pedidosDoPerfil = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/users/me'));

beforeEach(() => {
  sessionStorage.clear();
  replace.mockReset();
  push.mockReset();
  useAuthStore.setState({ accessToken: null, user: null });
  global.fetch = jest.fn(async (url: string) =>
    String(url).endsWith('/users/me') ? respostaJson(USUARIO) : respostaJson({}),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('ProtectedRoute sem sessão', () => {
  it('leva o #token= do OAuth junto no desvio para o login', async () => {
    window.history.replaceState(null, '', '/dashboard#token=abc');

    render(
      <React.StrictMode>
        <ProtectedRoute>
          <p>painel</p>
        </ProtectedRoute>
      </React.StrictMode>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith('/#token=abc');
  });

  it('um fragmento qualquer não é repassado', async () => {
    window.history.replaceState(null, '', '/dashboard#secao');

    render(
      <ProtectedRoute>
        <p>painel</p>
      </ProtectedRoute>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith('/');
  });
});

describe('tela de login com #token= na URL', () => {
  it('captura o token, cria a sessão e segue para o painel', async () => {
    sessionStorage.setItem(MARCA, String(Date.now()));
    window.history.replaceState(null, '', '/#token=abc');

    renderizarLogin();

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('abc'));
    expect(useAuthStore.getState().user?.id).toBe(USUARIO.id);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    // O fragmento sai da barra de endereço assim que é lido.
    expect(window.location.hash).toBe('');
    // A marca vale para um retorno só.
    expect(sessionStorage.getItem(MARCA)).toBeNull();
  });

  it('sem a marca de início, o token de um link de fora é recusado', async () => {
    window.history.replaceState(null, '', '/#token=token-do-atacante');

    renderizarLogin();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(pedidosDoPerfil()).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('marca de mais de dez minutos não vale', async () => {
    sessionStorage.setItem(MARCA, String(Date.now() - 11 * 60_000));
    window.history.replaceState(null, '', '/#token=abc');

    renderizarLogin();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(pedidosDoPerfil()).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('`#token=%` não derruba a página e sai da URL', async () => {
    sessionStorage.setItem(MARCA, String(Date.now()));
    window.history.replaceState(null, '', '/#token=%');

    renderizarLogin();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(pedidosDoPerfil()).toHaveLength(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
