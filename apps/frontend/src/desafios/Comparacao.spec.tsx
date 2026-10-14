/**
 * Comparacao.spec.tsx — "qual tem mais?".
 *
 * O que estes casos fixam: no EDHREC o MENOR número vence (é a posição), no
 * preço o maior; acertar soma na sequência e grava o recorde; errar zera a
 * sequência e mostra os dois valores.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Comparacao, MAIS_CARA, MAIS_JOGADA } from './Comparacao';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('../canvas/textureCache', () => ({ cardImageUrl: (id: string) => `/arte/${id}.jpg` }));

const SOL = { id: 'sol', name: 'Sol Ring', edhrec_rank: 1, prices: { usd: '1.50' } };
const BOLT = { id: 'bolt', name: 'Lightning Bolt', edhrec_rank: 300, prices: { usd: '2.00' } };

jest.mock('./cartas', () => ({
  ...jest.requireActual('./cartas'),
  paginaAoAcaso: jest.fn(async () => [SOL, BOLT]),
  // Ordem fixa: o teste sabe qual carta está em qual lado.
  sortearPar: jest.fn(() => [SOL, BOLT]),
}));

beforeEach(() => window.localStorage.clear());

it('no EDHREC, a de MENOR posição é a mais jogada', async () => {
  render(<Comparacao regra={MAIS_JOGADA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Sol Ring' }));

  expect(screen.getByText('Acertou!')).toBeInTheDocument();
  expect(screen.getByText('#1 no EDHREC')).toBeInTheDocument();
  expect(screen.getByText('#300 no EDHREC')).toBeInTheDocument();
  expect(window.localStorage.getItem('aethertable:desafio:mais-jogada')).toBe('1');
});

it('no preço, a maior vence — e errar zera a sequência', async () => {
  render(<Comparacao regra={MAIS_CARA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Sol Ring' }));

  expect(screen.getByText(/Errou/)).toBeInTheDocument();
  expect(screen.getByText('US$ 2.00')).toBeInTheDocument();
  expect(screen.getByText(/Sequência: 0/)).toBeInTheDocument();
});

it('depois de escolher, as duas cartas travam', async () => {
  render(<Comparacao regra={MAIS_JOGADA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Lightning Bolt' }));
  expect(screen.getByRole('button', { name: 'Escolher Sol Ring' })).toBeDisabled();
});
