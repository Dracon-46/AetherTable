/**
 * TokenPicker — a busca de fichas.
 *
 *  - O painel fica montado a partida inteira. Com ele FECHADO, o debounce
 *    disparava a busca genérica para todo jogador que entrava na mesa.
 *  - Duas buscas em voo: a resposta da mais antiga chegava depois e
 *    sobrescrevia a lista da mais nova.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from 'colyseus.js';
import { TokenPicker } from './TokenPicker';
import { useUIStore } from '../store/game.store';
import type { RoomState } from '../net/schema/RoomState';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const SALA = { state: { roomCode: 'ABCD' } } as unknown as Room<RoomState>;

/** Uma resposta de busca que o teste decide quando entregar. */
interface Pendente {
  termo: string;
  responder: (nomes: string[]) => Promise<void>;
}
let pendentes: Pendente[] = [];

function buscasFeitas(): string[] {
  return (global.fetch as jest.Mock).mock.calls
    .map(([url]) => new URL(String(url)).searchParams.get('q'))
    .filter((q): q is string => q !== null);
}

function abrirPainel() {
  act(() => {
    useUIStore.setState((s) => ({ activeModals: { ...s.activeModals, tokens: true } }));
  });
}

async function passar(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  pendentes = [];
  useUIStore.setState((s) => ({ activeModals: { ...s.activeModals, tokens: false } }));
  global.fetch = jest.fn(
    (url: string) =>
      new Promise((resolve) => {
        const termo = new URL(String(url)).searchParams.get('q') ?? '';
        pendentes.push({
          termo,
          responder: async (nomes) => {
            await act(async () => {
              resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  data: nomes.map((name) => ({ id: name.toLowerCase(), name })),
                }),
              });
              await Promise.resolve();
            });
          },
        });
      }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

const pendenteDe = (termo: string) => pendentes.find((p) => p.termo === termo)!;

describe('TokenPicker → busca', () => {
  it('com o painel fechado, não busca nada', async () => {
    render(<TokenPicker room={SALA} />);

    await passar(2_000);

    expect(buscasFeitas()).toEqual([]);
  });

  it('ao abrir, busca na hora, sem esperar o debounce', async () => {
    render(<TokenPicker room={SALA} />);
    abrirPainel();

    expect(buscasFeitas()).toEqual(['t:token']);
    // E o debounce não repete a mesma busca meio segundo depois.
    await passar(1_000);
    expect(buscasFeitas()).toEqual(['t:token']);
  });

  it('a resposta atrasada de uma busca antiga não sobrescreve a mais nova', async () => {
    render(<TokenPicker room={SALA} />);
    abrirPainel();
    await pendenteDe('t:token').responder(['Treasure']);

    const campo = screen.getByPlaceholderText(/Buscar token/);
    fireEvent.change(campo, { target: { value: 'zo' } });
    await passar(500);
    fireEvent.change(campo, { target: { value: 'zombie' } });
    await passar(500);

    // A busca nova volta primeiro; a antiga, depois.
    await pendenteDe('t:token zombie').responder(['Zombie']);
    await pendenteDe('t:token zo').responder(['Zoologist']);

    expect(screen.getByAltText('Zombie')).toBeInTheDocument();
    expect(screen.queryByAltText('Zoologist')).toBeNull();
  });
});
