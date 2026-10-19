/**
 * Sino.spec.tsx — o sino de notificações.
 *
 * O que estes casos fixam: o número conta os avisos e a versão de Novidades
 * que a pessoa ainda não viu; abrir zera o número (em todos os sinos montados)
 * mas mantém destacado o que acabou de chegar; e a denúncia analisada não vira
 * link para lugar nenhum.
 *
 * E, desde que o "já vi" foi para a conta: vale o MAIOR entre o navegador e a
 * conta; a conta é lida uma vez só, por mais sinos montados; abrir o sino
 * grava na conta; e uma falha de rede não desfaz nada na tela.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { haQuantoTempo, Sino } from './Sino';
import { useSinoStore, type Notificacao } from './useNotificacoes';
import { NOVIDADE_MAIS_RECENTE } from '../novidades/novidades';
import { api } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const AVISOS: Notificacao[] = [
  {
    tipo: 'CURTIDAS',
    em: '2026-10-14T11:00:00.000Z',
    deckId: 'd1',
    nomeDoDeck: 'Atraxa',
    quantas: 3,
  },
  {
    tipo: 'DENUNCIA_ANALISADA',
    em: '2026-10-13T10:00:00.000Z',
    denunciaId: 'r1',
    desfecho: 'RESOLVED',
  },
];

jest.mock('./useNotificacoes', () => ({
  ...jest.requireActual('./useNotificacoes'),
  useNotificacoes: () => ({ data: AVISOS }),
}));
jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;

beforeEach(() => {
  window.localStorage.clear();
  useSinoStore.setState({ vistoEm: null, versaoVista: null, carregado: false, contaBuscada: null });
  // Sem sessão por padrão: os casos de cima são do sino sozinho.
  useAuthStore.setState({ accessToken: null, user: null });
  apiMock.mockReset();
});

it('conta os avisos e a versão de Novidades ainda não vistos', () => {
  render(<Sino />);
  expect(screen.getByRole('button', { name: 'Notificações: 3 novas' })).toBeInTheDocument();
});

it('só o que chegou depois da última abertura conta', () => {
  window.localStorage.setItem('aethertable:sino-visto-em', '2026-10-14T00:00:00.000Z');
  window.localStorage.setItem('aethertable:novidade-vista', NOVIDADE_MAIS_RECENTE.versao);
  render(<Sino />);
  expect(screen.getByRole('button', { name: 'Notificações: 1 novas' })).toBeInTheDocument();
});

it('abrir zera o número de todos os sinos, mas destaca o que era novo', () => {
  render(
    <>
      <Sino />
      <Sino />
    </>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: /Notificações: 3 novas/ })[0]!);

  const dialogo = screen.getByRole('dialog');
  expect(dialogo).toHaveTextContent('"Atraxa" recebeu 3 curtidas.');
  expect(screen.getAllByLabelText('novo')).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Notificações' })).toHaveLength(2);
  expect(window.localStorage.getItem('aethertable:novidade-vista')).toBe(
    NOVIDADE_MAIS_RECENTE.versao,
  );
});

it('a denúncia analisada não vira link', () => {
  render(<Sino />);
  fireEvent.click(screen.getByRole('button', { name: /Notificações/ }));
  const texto = screen.getByText(/a moderação tomou uma medida/);
  expect(texto.closest('a')).toBeNull();
  expect(screen.getByText(/recebeu 3 curtidas/).closest('a')).toHaveAttribute(
    'href',
    '/dashboard/decks/d1',
  );
});

it('haQuantoTempo fala como gente', () => {
  const agora = new Date('2026-10-14T12:00:00Z').getTime();
  expect(haQuantoTempo('2026-10-14T11:59:30Z', agora)).toBe('agora');
  expect(haQuantoTempo('2026-10-14T11:55:00Z', agora)).toBe('há 5 minutos');
  expect(haQuantoTempo('2026-10-13T12:00:00Z', agora)).toBe('ontem');
});

describe('o "já vi" na conta', () => {
  const ANTIGA = '0.0.1';
  type Resposta = (
    caminho: string,
    opcoes?: { method?: string; body?: unknown },
  ) => Promise<unknown>;
  const responder = (r: Resposta) => apiMock.mockImplementation(r);
  const puts = () => apiMock.mock.calls.filter(([, o]) => o?.method === 'PUT');

  beforeEach(() => {
    useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  });

  it('vale o mais tarde: a conta viu depois deste navegador', async () => {
    // Este navegador abriu o sino de manhã; outra máquina abriu depois do aviso.
    window.localStorage.setItem('aethertable:sino-visto-em', '2026-10-13T00:00:00.000Z');
    window.localStorage.setItem('aethertable:novidade-vista', ANTIGA);
    responder(async () => ({
      vistoEm: '2026-10-14T11:30:00.000Z',
      novidadeVista: NOVIDADE_MAIS_RECENTE.versao,
    }));

    render(<Sino />);
    // Os dois avisos já foram vistos na outra máquina, e a Novidade também.
    expect(await screen.findByRole('button', { name: 'Notificações' })).toBeInTheDocument();
    expect(window.localStorage.getItem('aethertable:sino-visto-em')).toBe(
      '2026-10-14T11:30:00.000Z',
    );
    // A conta já sabia tudo: nada sobe.
    expect(puts()).toHaveLength(0);
  });

  it('vale o mais tarde: este navegador viu depois da conta — e sobe', async () => {
    window.localStorage.setItem('aethertable:sino-visto-em', '2026-10-14T11:30:00.000Z');
    window.localStorage.setItem('aethertable:novidade-vista', NOVIDADE_MAIS_RECENTE.versao);
    responder(async (_c, opcoes) =>
      opcoes?.method === 'PUT' ? opcoes.body : { vistoEm: null, novidadeVista: ANTIGA },
    );

    render(<Sino />);
    expect(await screen.findByRole('button', { name: 'Notificações' })).toBeInTheDocument();
    await waitFor(() =>
      expect(puts()[0]).toEqual([
        '/notificacoes/leitura',
        {
          method: 'PUT',
          body: {
            vistoEm: '2026-10-14T11:30:00.000Z',
            novidadeVista: NOVIDADE_MAIS_RECENTE.versao,
          },
        },
      ]),
    );
  });

  it('a Novidade atual lida em qualquer dos lados vale a atual', async () => {
    window.localStorage.setItem('aethertable:sino-visto-em', '2026-10-14T12:00:00.000Z');
    window.localStorage.setItem('aethertable:novidade-vista', ANTIGA);
    responder(async (_c, opcoes) =>
      opcoes?.method === 'PUT'
        ? opcoes.body
        : { vistoEm: '2026-10-01T00:00:00.000Z', novidadeVista: NOVIDADE_MAIS_RECENTE.versao },
    );

    render(<Sino />);
    // Sem avisos novos (o local é mais tarde) e sem Novidade nova (a conta leu).
    await waitFor(() =>
      expect(useSinoStore.getState().versaoVista).toBe(NOVIDADE_MAIS_RECENTE.versao),
    );
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });

  it('três sinos montados, UMA leitura da conta', async () => {
    responder(async () => ({ vistoEm: null, novidadeVista: null }));
    render(
      <>
        <Sino />
        <Sino />
        <Sino />
      </>,
    );
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.mock.calls.filter(([c, o]) => c === '/notificacoes/leitura' && !o)).toHaveLength(
      1,
    );
  });

  it('abrir o sino grava na conta', async () => {
    responder(async (_c, opcoes) =>
      opcoes?.method === 'PUT' ? opcoes.body : { vistoEm: null, novidadeVista: null },
    );
    render(<Sino />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Notificações: 3 novas/ }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    const corpo = puts()[0]![1]!.body as { vistoEm: string; novidadeVista: string };
    expect(corpo.novidadeVista).toBe(NOVIDADE_MAIS_RECENTE.versao);
    expect(corpo.vistoEm).toBe(useSinoStore.getState().vistoEm);
  });

  it('falha de rede não desfaz nada na tela', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    responder(async () => {
      throw new Error('sem rede');
    });
    render(<Sino />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    // A conta não respondeu: o sino segue com o que o navegador tem.
    expect(screen.getByRole('button', { name: 'Notificações: 3 novas' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notificações: 3 novas/ }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));

    // O PUT falhou, e o sino continua lido.
    expect(screen.getAllByRole('button', { name: 'Notificações' }).length).toBeGreaterThan(0);
    expect(window.localStorage.getItem('aethertable:novidade-vista')).toBe(
      NOVIDADE_MAIS_RECENTE.versao,
    );
    aviso.mockRestore();
  });
});
