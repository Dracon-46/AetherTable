/**
 * Meus Grimórios — criar um deck que o servidor recusa.
 *
 * `criarDeck` fazia `await criar.mutateAsync(...)` sem `catch`: a recusa
 * (nome inválido, 429, rede) virava rejeição não tratada no `onSubmit`. A
 * mensagem para a pessoa já sai do `criar.isError`; o que faltava era não
 * deixar a promessa estourar — e não navegar para um deck que não existe.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DecksPage from './page';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn() }),
}));

// A vitrine de decks iniciais busca a própria lista (react-query, que este
// teste não monta); o assunto aqui é o formulário de criação.
jest.mock('../../../deckbuilder/VitrineDeDecksIniciais', () => ({
  VitrineDeDecksIniciais: () => null,
}));

const mutateAsync = jest.fn();
jest.mock('../../../deckbuilder/useDecks', () => ({
  useListaDeDecks: () => ({ data: [], isPending: false, isError: false, error: null }),
  useCriarDeck: () => ({ mutateAsync, isPending: false, isError: false, error: null }),
  useApagarDeck: () => ({ mutate: jest.fn() }),
  // Favoritar/renomear e clonar entraram no cartão do deck; o teste não usa,
  // mas a página os chama no render.
  useAtualizarDeck: () => ({ mutate: jest.fn() }),
  useClonarDeck: () => ({ mutate: jest.fn() }),
  useGerarDeckAleatorio: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

it('a recusa ao criar não vira rejeição não tratada nem navegação', async () => {
  const rejeicoes: unknown[] = [];
  const ouvir = (motivo: unknown) => rejeicoes.push(motivo);
  process.on('unhandledRejection', ouvir);
  try {
    mutateAsync.mockRejectedValueOnce(new Error('nome inválido'));
    render(<DecksPage />);

    const nome = screen.getByPlaceholderText('Ex: Mono Blue Control');
    fireEvent.change(nome, { target: { value: 'Meu deck' } });
    fireEvent.submit(nome.closest('form')!);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 20)));

    expect(rejeicoes).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    // O nome fica para a pessoa corrigir.
    expect(nome).toHaveValue('Meu deck');
  } finally {
    process.off('unhandledRejection', ouvir);
  }
});
