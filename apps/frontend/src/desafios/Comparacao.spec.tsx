/**
 * Comparacao.spec.tsx — "qual tem mais?".
 *
 * O que estes casos fixam: no EDHREC o MENOR número vence (é a posição), no
 * preço o maior; acertar soma na sequência e sobe o recorde; errar zera a
 * sequência e mostra os dois valores.
 *
 * E, desde que o progresso foi para a conta: a sequência que a conta guardava
 * continua de onde parou (trocar de PC não zera); a pergunta abandonada
 * (`emJogo: true`) zera a sequência antes de o próximo par aparecer; e cada
 * par na tela avisa a conta de que há uma pergunta aberta.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProgressoDosDesafios } from '@aethertable/shared-types';
import { Comparacao, MAIS_CARA, MAIS_JOGADA } from './Comparacao';
import { reiniciarProgressoDosDesafios } from './progresso';
import { api } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('../canvas/textureCache', () => ({ cardImageUrl: (id: string) => `/arte/${id}.jpg` }));
jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));

const SOL = { id: 'sol', name: 'Sol Ring', edhrec_rank: 1, prices: { usd: '1.50' } };
const BOLT = { id: 'bolt', name: 'Lightning Bolt', edhrec_rank: 300, prices: { usd: '2.00' } };

jest.mock('./cartas', () => ({
  ...jest.requireActual('./cartas'),
  paginaAoAcaso: jest.fn(async () => [SOL, BOLT]),
  // Ordem fixa: o teste sabe qual carta está em qual lado.
  sortearPar: jest.fn(() => [SOL, BOLT]),
}));

const apiMock = api as jest.MockedFunction<typeof api>;

/** O que a conta tem guardado, como o `GET /users/me/desafios` devolve. */
let conta: ProgressoDosDesafios;

interface Corpo {
  sequencia: number;
  emJogo: boolean;
}

/** Os `PUT` mandados, na ordem: `[chave, corpo]`. */
function puts(): [string, Corpo][] {
  return apiMock.mock.calls
    .filter(([, opcoes]) => opcoes?.method === 'PUT')
    .map(([caminho, opcoes]) => [caminho.split('/').pop()!, opcoes!.body as Corpo]);
}

beforeEach(() => {
  window.localStorage.clear();
  reiniciarProgressoDosDesafios();
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  conta = {};
  apiMock.mockReset();
  apiMock.mockImplementation((caminho: string, opcoes?: { method?: string; body?: unknown }) => {
    if (caminho === '/users/me/desafios') return Promise.resolve(conta);
    if (opcoes?.method === 'PUT') {
      const corpo = opcoes.body as Corpo;
      return Promise.resolve({ recorde: corpo.sequencia, ...corpo });
    }
    return Promise.reject(new Error(`rota inesperada: ${caminho}`));
  });
});

it('no EDHREC, a de MENOR posição é a mais jogada', async () => {
  render(<Comparacao regra={MAIS_JOGADA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Sol Ring' }));

  expect(screen.getByText('Acertou!')).toBeInTheDocument();
  expect(screen.getByText('#1 no EDHREC')).toBeInTheDocument();
  expect(screen.getByText('#300 no EDHREC')).toBeInTheDocument();
  expect(screen.getByText(/Recorde: 1/)).toBeInTheDocument();
  // O recorde vai para a conta, e não mais para o `localStorage`.
  await waitFor(() =>
    expect(puts().at(-1)).toEqual(['mais-jogada', { sequencia: 1, emJogo: false }]),
  );
  expect(window.localStorage.getItem('aethertable:desafio:mais-jogada')).toBeNull();
});

it('no preço, a maior vence — e errar zera a sequência, não o recorde', async () => {
  conta = { 'mais-cara': { recorde: 5, sequencia: 3, emJogo: false } };
  render(<Comparacao regra={MAIS_CARA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Sol Ring' }));

  expect(screen.getByText(/Errou/)).toBeInTheDocument();
  expect(screen.getByText('US$ 2.00')).toBeInTheDocument();
  expect(screen.getByText(/Sequência: 0/)).toBeInTheDocument();
  expect(screen.getByText(/Recorde: 5/)).toBeInTheDocument();
  await waitFor(() =>
    expect(puts().at(-1)).toEqual(['mais-cara', { sequencia: 0, emJogo: false }]),
  );
});

it('depois de escolher, as duas cartas travam', async () => {
  render(<Comparacao regra={MAIS_JOGADA} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Lightning Bolt' }));
  expect(screen.getByRole('button', { name: 'Escolher Sol Ring' })).toBeDisabled();
});

it('a sequência que a conta guardava continua: trocar de PC não zera', async () => {
  conta = { 'mais-jogada': { recorde: 4, sequencia: 4, emJogo: false } };
  render(<Comparacao regra={MAIS_JOGADA} />);

  expect(await screen.findByText(/Sequência: 4/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Escolher Sol Ring' }));

  expect(screen.getByText(/Sequência: 5/)).toBeInTheDocument();
  expect(screen.getByText(/Recorde: 5/)).toBeInTheDocument();
  await waitFor(() =>
    expect(puts().at(-1)).toEqual(['mais-jogada', { sequencia: 5, emJogo: false }]),
  );
});

it('o par na tela é uma pergunta aberta; responder a fecha', async () => {
  conta = { 'mais-jogada': { recorde: 2, sequencia: 2, emJogo: false } };
  render(<Comparacao regra={MAIS_JOGADA} />);
  const botao = await screen.findByRole('button', { name: 'Escolher Sol Ring' });

  await waitFor(() => expect(puts()).toEqual([['mais-jogada', { sequencia: 2, emJogo: true }]]));
  fireEvent.click(botao);
  await waitFor(() =>
    expect(puts()).toEqual([
      ['mais-jogada', { sequencia: 2, emJogo: true }],
      ['mais-jogada', { sequencia: 3, emJogo: false }],
    ]),
  );
});

/**
 * A REGRA DA PERGUNTA ABANDONADA.
 *
 * A conta diz que havia uma pergunta aberta: a pessoa recarregou (ou trocou
 * de PC) diante de um par. Sem a regra, recarregar seria um jeito de pular o
 * par difícil sem perder a sequência.
 */
it('pergunta abandonada: a sequência zera antes do próximo par, e o recorde fica', async () => {
  conta = { 'mais-jogada': { recorde: 7, sequencia: 6, emJogo: true } };
  render(<Comparacao regra={MAIS_JOGADA} />);
  await screen.findByRole('button', { name: 'Escolher Sol Ring' });

  expect(screen.getByText(/Sequência: 0/)).toBeInTheDocument();
  expect(screen.getByText(/Recorde: 7/)).toBeInTheDocument();
  // Primeiro o zero (fechando a abandonada); só depois o par novo é aberto.
  await waitFor(() =>
    expect(puts()).toEqual([
      ['mais-jogada', { sequencia: 0, emJogo: false }],
      ['mais-jogada', { sequencia: 0, emJogo: true }],
    ]),
  );
});
