/**
 * SorteioOverlay.spec.tsx — "rolar dado e girar moeda aparecem animação?"
 *
 * Apareciam no PRIMEIRO giro. No segundo, com o primeiro ainda na tela, o
 * overlay reaproveitava os mesmos nós: a classe de animação não mudava, o CSS
 * não reinicia animação já terminada, e o dado aparecia parado com o número
 * novo. O teste prova que cada sorteio monta um elemento NOVO — que é o que
 * faz o navegador tocar a animação de novo.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { SorteioOverlay } from './SorteioOverlay';
import { useGameStore, useTableStore } from '../store/game.store';

beforeEach(() => {
  useTableStore.setState({ ultimoSorteio: null });
  useGameStore.setState({ mySessionId: 'eu', players: {} } as never);
});

describe('SorteioOverlay', () => {
  it('mostra o dado com a animação de entrada', () => {
    render(<SorteioOverlay />);
    act(() => useTableStore.getState().setDado({ actorId: 'eu', sides: 20, result: 17 }));

    const painel = screen.getByRole('status');
    expect(painel.className).toContain('animate-sorteio-entrada');
    expect(painel.textContent).toContain('Você rolou d20');
    expect(painel.querySelector('.animate-dado-rolar')).not.toBeNull();
  });

  it('mostra a moeda girando', () => {
    render(<SorteioOverlay />);
    act(() => useTableStore.getState().setMoeda({ actorId: 'eu', result: 'CARA' }));

    expect(screen.getByRole('status').querySelector('.animate-moeda-girar')).not.toBeNull();
  });

  it('o segundo giro, com o primeiro na tela, monta um elemento novo', () => {
    jest.useFakeTimers();
    render(<SorteioOverlay />);

    act(() => useTableStore.getState().setDado({ actorId: 'eu', sides: 6, result: 3 }));
    const primeiro = screen.getByRole('status');

    // `em` é Date.now(): sem avançar o relógio os dois carimbos coincidiriam.
    act(() => {
      jest.advanceTimersByTime(500);
      useTableStore.getState().setDado({ actorId: 'eu', sides: 6, result: 3 });
    });
    const segundo = screen.getByRole('status');

    expect(segundo).not.toBe(primeiro);
    jest.useRealTimers();
  });
});
