/**
 * Sino.spec.tsx — o sino de notificações.
 *
 * O que estes casos fixam: o número conta os avisos e a versão de Novidades
 * que a pessoa ainda não viu; abrir zera o número (em todos os sinos montados)
 * mas mantém destacado o que acabou de chegar; e a denúncia analisada não vira
 * link para lugar nenhum.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { haQuantoTempo, Sino } from './Sino';
import { useSinoStore, type Notificacao } from './useNotificacoes';
import { NOVIDADE_MAIS_RECENTE } from '../novidades/novidades';

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

beforeEach(() => {
  window.localStorage.clear();
  useSinoStore.setState({ vistoEm: null, versaoVista: null, carregado: false });
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
