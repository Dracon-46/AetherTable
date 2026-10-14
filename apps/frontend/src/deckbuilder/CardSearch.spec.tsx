/**
 * CardSearch.spec.tsx — o campo de quantidade e a falha ao adicionar.
 *
 *  - Apagar o "1" e digitar "4" dava 14: o valor era prendido em 1..99 a cada
 *    tecla, então o campo vazio voltava a ser "1" antes do "4" chegar.
 *  - A falha de `onAddCard` (um `mutateAsync`) escapava de um `try/finally`
 *    sem `catch` e virava rejeição não tratada — o aviso ao usuário já é
 *    trabalho do `onError` da mutação.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CardSearch, quantidadeValida } from './CardSearch';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(async () => ({
    data: [{ id: 'sf-1', name: 'Sol Ring', set: 'c21', type_line: 'Artifact' }],
  })),
}));

async function montar(onAddCard: (id: string, qtd: number) => Promise<void>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CardSearch onAddCard={onAddCard} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText(/Buscar carta/), { target: { value: 'sol' } });
  // Debounce de 300 ms + a query: o campo só existe depois do resultado.
  return (await screen.findByLabelText(
    'Quantidade de Sol Ring',
    {},
    { timeout: 5000 },
  )) as HTMLInputElement;
}

describe('quantidadeValida', () => {
  it('prende em 1..99 e trata vazio ou lixo como 1', () => {
    expect(quantidadeValida('4')).toBe(4);
    expect(quantidadeValida('')).toBe(1);
    expect(quantidadeValida(undefined)).toBe(1);
    expect(quantidadeValida('0')).toBe(1);
    expect(quantidadeValida('-3')).toBe(1);
    expect(quantidadeValida('150')).toBe(99);
  });
});

describe('CardSearch — campo de quantidade', () => {
  it('apagar e digitar "4" dá 4, não 14', async () => {
    const onAddCard = jest.fn(async () => {});
    const campo = await montar(onAddCard);

    fireEvent.change(campo, { target: { value: '' } });
    expect(campo.value).toBe('');
    fireEvent.change(campo, { target: { value: '4' } });
    expect(campo.value).toBe('4');

    fireEvent.click(screen.getByLabelText('Adicionar Sol Ring ao deck'));
    await waitFor(() => expect(onAddCard).toHaveBeenCalledWith('sf-1', 4));
  });

  it('o limite vale ao sair do campo', async () => {
    const campo = await montar(jest.fn(async () => {}));

    fireEvent.change(campo, { target: { value: '150' } });
    fireEvent.blur(campo);
    expect(campo.value).toBe('99');

    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.blur(campo);
    expect(campo.value).toBe('1');
  });

  it('adicionar com o campo vazio manda 1 e mostra 1', async () => {
    const onAddCard = jest.fn(async () => {});
    const campo = await montar(onAddCard);

    fireEvent.change(campo, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Adicionar Sol Ring ao deck'));

    await waitFor(() => expect(onAddCard).toHaveBeenCalledWith('sf-1', 1));
    expect(campo.value).toBe('1');
  });
});

describe('CardSearch — falha ao adicionar', () => {
  it('a rejeição de onAddCard não escapa como "Uncaught (in promise)"', async () => {
    const rejeicoes: unknown[] = [];
    const ouvir = (motivo: unknown) => rejeicoes.push(motivo);
    process.on('unhandledRejection', ouvir);
    try {
      const onAddCard = jest.fn(async () => {
        throw new Error('o servidor recusou');
      });
      await montar(onAddCard);
      const botao = screen.getByLabelText('Adicionar Sol Ring ao deck');

      fireEvent.click(botao);
      await waitFor(() => expect(onAddCard).toHaveBeenCalled());
      // O botão volta a ficar disponível: o `finally` rodou.
      await waitFor(() => expect(botao).not.toBeDisabled());
      // A detecção de rejeição não tratada acontece depois das microtarefas.
      await act(() => new Promise((r) => setTimeout(r, 20)));

      expect(rejeicoes).toEqual([]);
    } finally {
      process.off('unhandledRejection', ouvir);
    }
  });
});
