/**
 * Início do painel — o cartão do grimório mostrava o ID do formato.
 *
 * Era `{deck.formatId}` em caixa alta: "DUEL_COMMANDER", "BOOSTER_DRAFT" — o
 * identificador interno, onde a lista de grimórios e a tela do deck já
 * mostravam o nome do catálogo.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import { useAuthStore } from '../../store/auth.store';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('../../deckbuilder/useDecks', () => ({
  useListaDeDecks: () => ({
    data: [
      {
        id: 'd1',
        name: 'Duelo de Terça',
        formatId: 'duel_commander',
        cardCount: 100,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    isPending: false,
  }),
}));

// A vitrine de salas fala com o game server; aqui ela está vazia.
jest.mock('../../net/useSalasPublicas', () => ({
  ...jest.requireActual('../../net/useSalasPublicas'),
  useSalasPublicas: () => ({ data: [], isPending: false, isError: false, refetch: jest.fn() }),
}));

beforeEach(() => {
  useAuthStore.setState({ accessToken: 't', user: { id: 'u1', username: 'ana' } });
});

it('o cartão do grimório mostra o NOME do formato, não o id', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DashboardPage />
    </QueryClientProvider>,
  );

  const cartao = screen.getByRole('link', { name: /Duelo de Terça/ });
  expect(cartao).toHaveTextContent('Duel Commander');
  expect(cartao.textContent).not.toMatch(/duel_commander/i);
});
