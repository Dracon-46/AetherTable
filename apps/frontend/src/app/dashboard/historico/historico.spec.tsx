/**
 * Histórico — a tela das partidas jogadas.
 *
 * O que estes casos fixam: a aba de resultado vira filtro da consulta, o
 * detalhe mostra a mesa inteira, "Abrir o deck" só existe para o deck da
 * própria conta e o resumo copiado diz quem venceu e como cada um caiu.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HistoricoPage from './page';
import type { PartidaDoHistorico } from '../../../historico/useHistorico';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('../../../canvas/textureCache', () => ({
  cardImageUrl: (id: string) => `/arte/${id}.jpg`,
}));

jest.mock('../../../cards/catalog', () => ({
  useCardCatalog: (seletor: (s: unknown) => unknown) =>
    seletor({ cartas: { 'scry-eu': { name: 'Atraxa' }, 'scry-ele': { name: 'Krenko' } } }),
  useHidratarCartas: () => {},
}));

const PARTIDA: PartidaDoHistorico = {
  id: 'p1',
  terminouEm: '2026-10-14T21:40:00.000Z',
  duracaoSegundos: 3900,
  formato: 'COMMANDER',
  rodadas: 11,
  jogadores: 2,
  resultado: 'DERROTA',
  participantes: [
    {
      nome: 'Eu',
      usuario: 'eu',
      souEu: true,
      deckId: 'deck-meu',
      nomeDoDeck: 'Superfriends',
      comandanteId: 'scry-eu',
      bracket: 3,
      vidaFinal: 0,
      venceu: false,
      comecou: true,
      saiuAntes: false,
      motivoDaEliminacao: 'LIFE',
    },
    {
      nome: 'Rival',
      usuario: 'rival',
      souEu: false,
      deckId: null,
      nomeDoDeck: 'Goblins',
      comandanteId: 'scry-ele',
      bracket: 2,
      vidaFinal: 17,
      venceu: true,
      comecou: false,
      saiuAntes: false,
      motivoDaEliminacao: null,
    },
  ],
};

const useHistorico = jest.fn();
jest.mock('../../../historico/useHistorico', () => ({
  ...jest.requireActual('../../../historico/useHistorico'),
  useHistorico: (filtros: unknown) => useHistorico(filtros),
  useEstatisticasDoHistorico: () => ({
    data: {
      partidas: 10,
      vitorias: 3,
      taxaDeVitoria: 0.3,
      duracaoMediaSegundos: 2700,
      comandanteMaisJogado: { comandanteId: 'scry-eu', partidas: 6 },
    },
  }),
}));

beforeEach(() => {
  useHistorico.mockReset();
  useHistorico.mockReturnValue({
    data: { total: 1, pagina: 1, porPagina: 20, partidas: [PARTIDA] },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
  });
});

it('a aba de resultado vira filtro da consulta e volta à primeira página', () => {
  render(<HistoricoPage />);
  expect(useHistorico).toHaveBeenLastCalledWith({
    resultado: 'todas',
    formato: undefined,
    pagina: 1,
  });

  fireEvent.click(screen.getByRole('tab', { name: 'Vitórias' }));
  expect(useHistorico).toHaveBeenLastCalledWith({
    resultado: 'vitorias',
    formato: undefined,
    pagina: 1,
  });
});

it('os números do topo usam o catálogo para o nome do comandante', () => {
  render(<HistoricoPage />);
  expect(screen.getByText('3 (30 %)')).toBeInTheDocument();
  expect(screen.getByText('Atraxa (6)')).toBeInTheDocument();
  expect(screen.getByText('45 min')).toBeInTheDocument();
});

it('o detalhe mostra a mesa, abre só o próprio deck e copia o resumo', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<HistoricoPage />);

  fireEvent.click(screen.getByText('Superfriends'));
  const dialogo = screen.getByRole('dialog');
  expect(dialogo).toHaveTextContent('Rival');
  expect(dialogo).toHaveTextContent('Goblins — Krenko');
  expect(dialogo).toHaveTextContent('vida zerada');

  const abrir = screen.getByRole('link', { name: 'Abrir o deck' });
  expect(abrir).toHaveAttribute('href', '/dashboard/decks/deck-meu');

  fireEvent.click(screen.getByRole('button', { name: /Copiar resumo/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  const texto = writeText.mock.calls[0]![0] as string;
  expect(texto).toContain('🏆 Rival (Goblins — Krenko): venceu');
  expect(texto).toContain('• Eu (Superfriends — Atraxa): vida zerada');
});

it('sem partidas, a tela explica de onde elas vêm', () => {
  useHistorico.mockReturnValue({
    data: { total: 0, pagina: 1, porPagina: 20, partidas: [] },
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
  });
  render(<HistoricoPage />);
  expect(screen.getByText(/Elas aparecem aqui quando a mesa termina/)).toBeInTheDocument();
});
