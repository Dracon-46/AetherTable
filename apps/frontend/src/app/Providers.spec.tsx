/**
 * Providers.spec.tsx — "saí da minha conta, entrei na do meu irmão e os decks
 * eram os meus".
 *
 * As chaves do react-query não carregam o usuário e nada limpava o cache entre
 * contas: dentro do `staleTime`, a conta nova via os dados da anterior sem nem
 * uma revalidação. O teste prova que a troca de IDENTIDADE esvazia o cache — e
 * que regravar o mesmo usuário (renomear no perfil) não esvazia.
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Providers } from './Providers';
import { useAuthStore } from '../store/auth.store';

const LISTA = ['decks', 'lista'];

function renderizar(): QueryClient {
  let client: QueryClient | null = null;
  function Espiao() {
    client = useQueryClient();
    return null;
  }
  render(
    <React.StrictMode>
      <Providers>
        <Espiao />
      </Providers>
    </React.StrictMode>,
  );
  if (!client) throw new Error('QueryClient não montou');
  return client;
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token-a', user: { id: 'a', username: 'ana' } });
});

describe('Providers — cache por conta', () => {
  it('sair da conta esvazia o cache', () => {
    const client = renderizar();
    client.setQueryData(LISTA, [{ id: 'deck-da-ana' }]);

    act(() => useAuthStore.getState().logout());

    expect(client.getQueryData(LISTA)).toBeUndefined();
  });

  it('entrar com outra conta sem sair antes também esvazia', () => {
    // O caminho do OAuth com sessão aberta: `setAuth` direto por cima.
    const client = renderizar();
    client.setQueryData(LISTA, [{ id: 'deck-da-ana' }]);
    client.setQueryData(['admin', 'eu'], { id: 'a', papel: 'ADMIN' });

    act(() => useAuthStore.getState().setAuth('token-b', { id: 'b', username: 'bia' }));

    expect(client.getQueryData(LISTA)).toBeUndefined();
    expect(client.getQueryData(['admin', 'eu'])).toBeUndefined();
  });

  it('regravar o MESMO usuário não esvazia — renomear não é trocar de conta', () => {
    const client = renderizar();
    client.setQueryData(LISTA, [{ id: 'deck-da-ana' }]);

    act(() => useAuthStore.getState().setAuth('token-a', { id: 'a', username: 'ana-renomeada' }));
    act(() => useAuthStore.getState().setAccessToken('token-a2'));

    expect(client.getQueryData(LISTA)).toEqual([{ id: 'deck-da-ana' }]);
  });

  it('sair e entrar com outra conta: a segunda não herda nada da primeira', () => {
    const client = renderizar();
    client.setQueryData(LISTA, [{ id: 'deck-da-ana' }]);

    act(() => useAuthStore.getState().logout());
    act(() => useAuthStore.getState().setAuth('token-b', { id: 'b', username: 'bia' }));

    expect(client.getQueryData(LISTA)).toBeUndefined();
  });

  it('entrar vindo de "ninguém" preserva o cache público da tela de login', () => {
    // Limpar aqui derrubava a query ativa de `/auth/provedores` e os botões de
    // OAuth piscavam no meio do redirecionamento para o painel.
    useAuthStore.setState({ accessToken: null, user: null });
    const client = renderizar();
    client.setQueryData(['auth', 'provedores'], { google: true });

    act(() => useAuthStore.getState().setAuth('token-a', { id: 'a', username: 'ana' }));

    expect(client.getQueryData(['auth', 'provedores'])).toEqual({ google: true });
  });
});
