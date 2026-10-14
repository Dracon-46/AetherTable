/**
 * Ajustes — "troquei meu nome, voltei depois e ele tinha desfeito sozinho".
 *
 * Dois defeitos no mesmo formulário:
 *  - o apelido em branco ia como `displayName: ''` e o servidor recusava o
 *    salvamento inteiro;
 *  - salvar não atualizava o store de onde o formulário se preenche. Voltar à
 *    tela mostrava o nome ANTIGO, e o próximo salvamento o reenviava — a troca
 *    era revertida em silêncio.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPage from './page';
import { useAuthStore } from '../../../store/auth.store';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
// As outras duas seções da tela não participam do formulário de perfil.
jest.mock('../../../components/CosmeticPicker', () => ({ CosmeticPicker: () => null }));
jest.mock('./TrocarSenha', () => ({ TrocarSenha: () => null }));

function resposta(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => corpo,
  };
}

const chamadas = () => (global.fetch as jest.Mock).mock.calls;

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'token',
    user: { id: 'u1', username: 'antigo', displayName: null },
  });
  global.fetch = jest.fn(async () =>
    resposta(200, { id: 'u1', username: 'novo', displayName: null, avatarUrl: null }),
  ) as unknown as typeof fetch;
});

describe('Ajustes → salvar perfil', () => {
  it('grava no store o que o servidor devolveu: reabrir a tela mostra o nome novo', async () => {
    const { unmount } = render(<SettingsPage />);

    const campo = screen.getByDisplayValue('antigo');
    fireEvent.change(campo, { target: { value: 'novo' } });
    fireEvent.submit(campo.closest('form')!);

    await waitFor(() => expect(useAuthStore.getState().user?.username).toBe('novo'));
    expect(useAuthStore.getState().user?.id).toBe('u1');

    // "Voltar depois": a tela remonta a partir do store.
    unmount();
    render(<SettingsPage />);
    expect(screen.getByDisplayValue('novo')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('antigo')).toBeNull();
  });

  it('apelido em branco não vai no corpo do PATCH', async () => {
    render(<SettingsPage />);
    fireEvent.submit(screen.getByDisplayValue('antigo').closest('form')!);

    await waitFor(() => expect(chamadas()).toHaveLength(1));
    const corpo = JSON.parse(chamadas()[0][1].body as string);
    expect(corpo).not.toHaveProperty('displayName');
    expect(corpo.username).toBe('antigo');
  });

  it('a recusa do servidor mostra o campo e o motivo, não "Dados inválidos."', async () => {
    global.fetch = jest.fn(async () =>
      resposta(400, {
        message: 'Dados inválidos.',
        erros: [
          { campo: 'username', erro: 'Use apenas letras, números, ponto, hífen ou underline' },
        ],
      }),
    ) as unknown as typeof fetch;

    render(<SettingsPage />);
    fireEvent.submit(screen.getByDisplayValue('antigo').closest('form')!);

    expect(
      await screen.findByText(
        /Nome de usuário: Use apenas letras, números, ponto, hífen ou underline/,
      ),
    ).toBeInTheDocument();
    // Recusado = nada muda no store.
    expect(useAuthStore.getState().user?.username).toBe('antigo');
  });
});
