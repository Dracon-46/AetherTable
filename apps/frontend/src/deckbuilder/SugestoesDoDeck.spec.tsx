/**
 * SugestoesDoDeck.spec.tsx — o painel de cartas recomendadas.
 *
 * Sem comandante não há de onde tirar sugestão (e nenhuma consulta sai); com
 * ele, cada papel vira um grupo, e o que se adiciona some da lista na hora.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SugestoesDoDeck } from './SugestoesDoDeck';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

jest.mock('../canvas/textureCache', () => ({ cardImageUrl: (id: string) => `/arte/${id}.jpg` }));

const useQuery = jest.fn();
jest.mock('@tanstack/react-query', () => ({ useQuery: (o: unknown) => useQuery(o) }));

beforeEach(() => {
  useQuery.mockReset();
  useQuery.mockReturnValue({
    data: {
      comandantes: ['Ghalta, Primal Hunger'],
      temas: ['tribo Dinosaur'],
      grupos: [
        {
          papel: 'ramp',
          nome: 'Aceleração de mana',
          cartas: [
            {
              scryfallId: 'cultivate',
              name: 'Cultivate',
              typeLine: 'Sorcery',
              manaCost: '{2}{G}',
              gameChanger: false,
            },
            {
              scryfallId: 'crop',
              name: 'Crop Rotation',
              typeLine: 'Instant',
              manaCost: '{G}',
              gameChanger: true,
            },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
    error: null,
  });
});

it('sem comandante, explica de onde vêm as sugestões', () => {
  render(<SugestoesDoDeck deckId="d1" comandantes="" onAddCard={jest.fn()} />);
  expect(screen.getByText(/As sugestões partem do comandante/)).toBeInTheDocument();
});

it('mostra o tema e os grupos, avisa o Game Changer e tira da lista o que foi adicionado', async () => {
  const onAddCard = jest.fn().mockResolvedValue(undefined);
  render(<SugestoesDoDeck deckId="d1" comandantes="ghalta" onAddCard={onAddCard} />);

  expect(screen.getByText('tribo Dinosaur')).toBeInTheDocument();
  expect(screen.getByText('Aceleração de mana')).toBeInTheDocument();
  expect(screen.getByText('Game Changer')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Adicionar Cultivate ao deck'));
  await waitFor(() => expect(screen.queryByText('Cultivate')).not.toBeInTheDocument());
  expect(onAddCard).toHaveBeenCalledWith('cultivate', 1);
  expect(screen.getByText('Crop Rotation')).toBeInTheDocument();
});

it('se adicionar falha, a carta continua na lista', async () => {
  const onAddCard = jest.fn().mockRejectedValue(new Error('429'));
  render(<SugestoesDoDeck deckId="d1" comandantes="ghalta" onAddCard={onAddCard} />);
  fireEvent.click(screen.getByLabelText('Adicionar Cultivate ao deck'));
  await waitFor(() => expect(onAddCard).toHaveBeenCalled());
  expect(screen.getByText('Cultivate')).toBeInTheDocument();
});
