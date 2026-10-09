/**
 * useHidratarPreferencias — as preferências da conta sob StrictMode.
 *
 * A limpeza do efeito zerava o `ativo` da única requisição em voo, e a guarda
 * `jaBuscou` impedia a segunda montagem de pedir de novo: em desenvolvimento,
 * tema, cosméticos, atalhos e o tier de apoiador nunca eram aplicados.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useHidratarPreferencias } from './useHidratarPreferencias';
import { useAuthStore } from './auth.store';
import { useCosmeticos } from '../cosmetics/store';
import { api } from '../lib/fetcher';

jest.mock('../lib/fetcher', () => ({
  ...jest.requireActual('../lib/fetcher'),
  api: jest.fn(),
}));
// O catálogo autoral é outra busca (react-query); não participa da guarda.
jest.mock('../cosmetics/useCatalogo', () => ({ useCatalogoDeCosmeticos: () => 0 }));

const apiMock = api as jest.MockedFunction<typeof api>;

function Casca() {
  useHidratarPreferencias();
  return null;
}

beforeEach(() => {
  apiMock.mockReset();
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

  it('fora do StrictMode continua sendo UMA requisição por montagem', async () => {
    apiMock.mockResolvedValue({ supporterTier: 'APOIADOR', preference: null });

    const { rerender, unmount } = render(<Casca />);
    await waitFor(() => expect(useCosmeticos.getState().tier).toBe('APOIADOR'));
    rerender(<Casca />);

    expect(apiMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a resposta que chega depois da desmontagem não é aplicada', async () => {
    let responder: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(new Promise((r) => (responder = r)) as never);

    const { unmount } = render(<Casca />);
    unmount();
    responder({ supporterTier: 'APOIADOR', preference: null });
    await Promise.resolve();

    expect(useCosmeticos.getState().tier).toBe('FREE');
  });
});
