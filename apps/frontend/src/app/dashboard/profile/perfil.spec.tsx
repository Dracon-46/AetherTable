/**
 * Meu Perfil — o apelido opcional em branco derrubava o salvamento.
 *
 * O formulário mandava `displayName: ''` para todo mundo que nunca escolheu
 * apelido (quase todo mundo), e o servidor recusava o PATCH inteiro: trocar o
 * nome de usuário por esta tela era impossível para essas contas.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfilePage from './page';
import { useAuthStore } from '../../../store/auth.store';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

function resposta(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => corpo,
  };
}

const PERFIL = {
  id: 'u1',
  username: 'ana',
  displayName: null,
  email: 'ana@exemplo.com',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? resposta(200, { ...PERFIL, username: 'ana2', displayName: 'Ana' })
      : resposta(200, PERFIL),
  ) as unknown as typeof fetch;
});

const patches = () =>
  (global.fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === 'PATCH');

describe('Meu Perfil → salvar', () => {
  it('com o apelido em branco, o PATCH sai sem `displayName`', async () => {
    render(<ProfilePage />);
    const campo = await screen.findByDisplayValue('ana');
    fireEvent.change(campo, { target: { value: 'ana2' } });
    fireEvent.submit(campo.closest('form')!);

    await waitFor(() => expect(patches()).toHaveLength(1));
    const corpo = JSON.parse(patches()[0][1].body as string);
    expect(corpo).toEqual({ username: 'ana2' });
  });

  it('o store recebe o apelido que o servidor devolveu', async () => {
    render(<ProfilePage />);
    fireEvent.submit((await screen.findByDisplayValue('ana')).closest('form')!);

    await waitFor(() => expect(useAuthStore.getState().user?.displayName).toBe('Ana'));
    expect(useAuthStore.getState().user?.username).toBe('ana2');
  });
});
