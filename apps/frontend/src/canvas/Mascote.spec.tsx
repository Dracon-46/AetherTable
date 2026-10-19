/**
 * Mascote — a animação precisa ANDAR.
 *
 * O efeito da animação dependia do array de pontos, que nasce novo a cada
 * render. Cada quadro re-renderizava, reiniciava o efeito e zerava o relógio:
 * o mascote ficava preso no primeiro quadro para sempre.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Mascote } from './Mascote';

// O Konva precisa de canvas de verdade; aqui só interessa a posição do grupo.
jest.mock('react-konva', () => {
  const { createElement } = jest.requireActual<typeof React>('react');
  return {
    Group: ({ y, children }: { y: number; children?: React.ReactNode }) =>
      createElement('div', { 'data-testid': 'mascote', 'data-y': y }, children),
    Circle: () => null,
    Line: () => null,
  };
});

const BASE_Y = 100;
const alturaAtual = () => Number(screen.getByTestId('mascote').getAttribute('data-y'));

/**
 * Avança quadro a quadro, cada um no seu `act`: é o que deixa o React
 * re-renderizar entre um quadro e outro, como no navegador. Num `act` só,
 * os quadros seriam agrupados num render e o defeito não apareceria.
 */
function passarQuadros(ms: number) {
  for (let i = 0; i < ms / 16; i += 1) {
    act(() => {
      jest.advanceTimersByTime(16);
    });
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Mascote', () => {
  it('o mascote que flutua sai do lugar com o passar do tempo', () => {
    // O Dragonete flutua: sobe e desce até 5 px em torno da base.
    render(<Mascote petId="dragao" x={0} y={BASE_Y} />);

    passarQuadros(500);

    // Em meio segundo a fase da onda passa de 0,7: bem mais de 1 px de subida.
    // Preso no primeiro quadro, ficaria a uma fração de pixel da base.
    expect(alturaAtual() - BASE_Y).toBeGreaterThan(1);
  });

  it('com movimento reduzido, fica parado', () => {
    window.matchMedia = jest.fn(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;

    render(<Mascote petId="dragao" x={0} y={BASE_Y} />);
    passarQuadros(500);

    expect(alturaAtual()).toBe(BASE_Y);
  });
});
