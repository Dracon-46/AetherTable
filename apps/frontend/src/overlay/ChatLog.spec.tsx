/**
 * ChatLog.spec.tsx — dividir o log e abrir em outra janela.
 *
 * O que estes casos fixam: dividido, o chat sai do meio das ações e ganha
 * lista própria; destacado, o log é desenhado NA OUTRA JANELA (portal, mesma
 * sala) e a mesa mostra só o caminho de volta; pop-up bloqueado vira aviso, e
 * não um painel que some.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from 'colyseus.js';
import { ChatLog } from './ChatLog';
import { useGameStore, useUIStore } from '../store/game.store';
import { useToast } from '../components/Toast';
import type { RoomState } from '../net/schema/RoomState';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('../cards/catalog', () => ({
  useCardCatalog: (seletor: (s: unknown) => unknown) => seletor({ cartas: {}, hidratar: () => {} }),
}));

const SALA = { send: jest.fn() } as unknown as Room<RoomState>;

beforeEach(() => {
  useUIStore.setState({ logAberto: true, logDividido: false });
  useGameStore.setState({
    mySessionId: 'eu',
    players: { eu: { name: 'Eu' }, ele: { name: 'Ele' } },
    espectadores: {},
    log: [
      { id: '1', timestamp: 0, type: 'DRAW', actorId: 'ele', text: 'Ele comprou uma carta' },
      { id: '2', timestamp: 0, type: 'CHAT', actorId: 'ele', text: 'boa sorte' },
      { id: '3', timestamp: 0, type: 'LIFE', actorId: 'eu', text: 'Eu perdeu 3 de vida' },
    ],
  } as never);
  useToast.setState({ itens: [] });
});

it('dividido, o chat ganha lista própria e a aba Chat some', () => {
  render(<ChatLog room={SALA} />);
  expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Separar chat e ações' }));

  expect(useUIStore.getState().logDividido).toBe(true);
  expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument();
  // A aba Vida filtra só as ações; o chat continua à vista na lista dele.
  fireEvent.click(screen.getByRole('button', { name: 'Vida' }));
  expect(screen.queryByText('Ele comprou uma carta')).not.toBeInTheDocument();
  expect(screen.getByText('Eu perdeu 3 de vida')).toBeInTheDocument();
  expect(screen.getByText('boa sorte')).toBeInTheDocument();
});

it('destacado, o log é desenhado na outra janela e a mesa mostra o caminho de volta', () => {
  const doc = document.implementation.createHTMLDocument('popup');
  const janela = {
    document: doc,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  const abrir = jest.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

  render(<ChatLog room={SALA} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir o log em outra janela' }));

  expect(abrir).toHaveBeenCalledWith('', 'aethertable-log', expect.stringContaining('popup'));
  expect(doc.title).toBe('Log da mesa — AetherTable');
  const raiz = doc.getElementById('aether-log')!;
  // O elemento é de OUTRO documento: `toBeInTheDocument` olha só o principal.
  expect(raiz.textContent).toContain('boa sorte');
  expect(raiz.textContent).toContain('Ele comprou uma carta');
  expect(screen.getByText(/O log está aberto em outra janela/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Trazer de volta' }));
  expect(janela.closed).toBe(true);
  expect(screen.getByRole('button', { name: 'Abrir o log em outra janela' })).toBeInTheDocument();
});

it('fechar a janela pelo X dela devolve o log à mesa', () => {
  jest.useFakeTimers();
  try {
    const doc = document.implementation.createHTMLDocument('popup');
    const janela = { document: doc, closed: false, close: () => {} };
    jest.spyOn(window, 'open').mockReturnValue(janela as unknown as Window);

    render(<ChatLog room={SALA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o log em outra janela' }));
    janela.closed = true;
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(screen.queryByText(/O log está aberto em outra janela/)).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

it('pop-up bloqueado vira aviso, e o log fica na mesa', () => {
  jest.spyOn(window, 'open').mockReturnValue(null);
  render(<ChatLog room={SALA} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir o log em outra janela' }));
  expect(useToast.getState().itens[0]?.texto).toMatch(/bloqueou a janela/);
  expect(screen.getByText('boa sorte')).toBeInTheDocument();
});
