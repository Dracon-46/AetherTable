/**
 * useHidratarPreferencias — as preferências da conta sob StrictMode.
 *
 * A limpeza do efeito zerava o `ativo` da única requisição em voo, e a guarda
 * `jaBuscou` impedia a segunda montagem de pedir de novo: em desenvolvimento,
 * tema, cosméticos, atalhos e o tier de apoiador nunca eram aplicados.
 *
 * E a mesma guarda impedia o token NOVO da troca de senha de hidratar: o
 * observador das preferências de mesa ficava desligado e nada mais chegava à
 * conta.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useHidratarPreferencias } from './useHidratarPreferencias';
import { useAuthStore } from './auth.store';
import { useCosmeticos } from '../cosmetics/store';
import { api } from '../lib/fetcher';
import { observarPreferenciasDaMesa } from './preferencias-da-conta';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));
jest.mock('./preferencias-da-conta', () => ({
  ...jest.requireActual('./preferencias-da-conta'),
  observarPreferenciasDaMesa: jest.fn(),
}));
// O catálogo autoral é outra busca (react-query); não participa da guarda.
jest.mock('../cosmetics/useCatalogo', () => ({ useCatalogoDeCosmeticos: () => 0 }));

const apiMock = api as jest.MockedFunction<typeof api>;
const observarMock = observarPreferenciasDaMesa as jest.MockedFunction<
  typeof observarPreferenciasDaMesa
>;
const pararDeObservar = jest.fn();

function Casca() {
  useHidratarPreferencias();
  return null;
}

beforeEach(() => {
  apiMock.mockReset();
  pararDeObservar.mockReset();
  observarMock.mockReset();
  observarMock.mockReturnValue(pararDeObservar);
  useAuthStore.setState({ accessToken: 'token', user: { id: 'u1', username: 'ana' } });
  useCosmeticos.setState({ tier: 'FREE' });
});

describe('useHidratarPreferencias', () => {
  it('sob StrictMode, o tier da conta é aplicado', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: null });

    const { unmount } = render(
      <React.StrictMode>
        <Casca />
      </React.StrictMode>,
    );

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    unmount();
  });

  it('sob StrictMode, a remontagem aproveita o pedido em voo: UMA requisição', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: {} });

    const { unmount } = render(
      <React.StrictMode>
        <Casca />
      </React.StrictMode>,
    );

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    expect(apiMock).toHaveBeenCalledTimes(1);
    // Aplicada uma vez: um observador só, não um por montagem.
    expect(observarMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('trocar a senha (token novo) hidrata de novo e religa o observador', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'FREE', preference: {} });
    const { unmount } = render(<Casca />);
    await waitFor(() => expect(observarMock).toHaveBeenCalledTimes(1));

    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: {} });
    act(() => {
      useAuthStore.getState().setAccessToken('token-depois-da-troca-de-senha');
    });

    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    expect(apiMock).toHaveBeenCalledTimes(2);
    // O observador do token antigo foi desligado, e um novo, ligado.
    expect(pararDeObservar).toHaveBeenCalledTimes(1);
    expect(observarMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('fora do StrictMode continua sendo UMA requisição por montagem', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: null });

    const { rerender, unmount } = render(<Casca />);
    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    rerender(<Casca />);

    expect(apiMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a placa de nome salva na conta é hidratada junto com os outros cosméticos', async () => {
    // Sem esta linha no hook, a placa ficaria presa ao `localStorage`: trocar
    // de máquina devolvia o jogador ao nome sem placa — o mesmo relato que
    // trouxe os outros cosméticos para a conta.
    apiMock.mockResolvedValue({
      supporterTier: 'APOIADOR',
      preference: { borderId: 'chama', nameplateId: 'ouro-real' },
    });

    const { unmount } = render(<Casca />);
    await waitFor(() => expect(useCosmeticos.getState().nameplateId).toBe('ouro-real'));
    expect(useCosmeticos.getState().borderId).toBe('chama');
    unmount();
  });

  it('a resposta que chega depois da desmontagem não é aplicada', async () => {
    let responder: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (responder = r)));

    const { unmount } = render(<Casca />);
    unmount();
    responder({ supporterTier: 'APOIADOR', preference: null });
    await Promise.resolve();

    expect(useCosmeticos.getState().tier).toBe('FREE');
  });
});
