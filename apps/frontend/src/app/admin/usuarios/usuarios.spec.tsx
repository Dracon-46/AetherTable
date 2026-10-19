/**
 * Backoffice → Usuários — "Retirar item" não tinha botão.
 *
 * A ação `revogar` tinha título, diálogo, mutação (`DELETE …/inventario`) e
 * caso no `confirmar`, e nenhum botão chamava `setAcao('revogar')`: um item
 * concedido por engano só saía mexendo no banco.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import UsuariosPage from './page';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const USUARIO = {
  id: 'u-1',
  email: 'ana@exemplo.com',
  username: 'ana',
  displayName: null,
  avatarUrl: null,
  role: 'USER',
  emailVerifiedAt: null,
  lastSeenAt: null,
  deletedAt: null,
  suspendedUntil: null,
  suspensionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  _count: { decks: 0, reportsGot: 0 },
};

/** Cada `useAcaoDeUsuario` da página, com a rota e o método com que nasceu. */
const acoes: { rota: string; method: string; mutate: jest.Mock }[] = [];

jest.mock('../../../admin/useAdmin', () => ({
  useSouAdmin: () => ({ data: { id: 'adm', username: 'chefe', papel: 'ADMIN' } }),
  useUsuarios: () => ({
    data: { itens: [USUARIO], proximoCursor: null },
    isPending: false,
    isError: false,
    error: null,
  }),
  useUsuario: (id: string | null) => ({ data: id ? USUARIO : undefined, isPending: false }),
  useCosmeticos: () => ({
    data: {
      catalogo: [],
      registrados: [{ id: 'reg-1', name: 'Protetor Dourado', type: 'SLEEVE' }],
    },
  }),
  useAcaoDeUsuario: (rota: (id: string) => string, method = 'POST') => {
    const acao = { rota: rota('ID'), method, mutate: jest.fn() };
    acoes.push(acao);
    return { mutate: acao.mutate, isPending: false, error: null };
  },
}));

beforeEach(() => {
  acoes.length = 0;
});

it('"Retirar item" abre o diálogo de retirada e chama o DELETE do inventário', () => {
  render(<UsuariosPage />);
  fireEvent.click(screen.getByText('ana', { selector: 'span' }).closest('tr')!);

  fireEvent.click(screen.getByRole('button', { name: /Retirar item/ }));
  expect(screen.getByRole('heading', { name: 'Retirar cosmético' })).toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('Por que esta ação está sendo tomada?'), {
    target: { value: 'concedido por engano' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retirar' }));

  const chamadas = acoes.filter((a) => a.mutate.mock.calls.length > 0);
  expect(chamadas).toHaveLength(1);
  expect(chamadas[0]).toMatchObject({ rota: '/admin/usuarios/ID/inventario', method: 'DELETE' });
  expect(chamadas[0]!.mutate.mock.calls[0][0]).toEqual({
    id: 'u-1',
    corpo: { cosmeticoId: 'reg-1', motivo: 'concedido por engano' },
  });
});
