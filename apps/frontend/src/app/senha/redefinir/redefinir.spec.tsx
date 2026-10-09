/**
 * /senha/redefinir — o link do e-mail abria em "Link incompleto".
 *
 * O efeito lia o `?token=` e o apagava da barra de endereço; o StrictMode roda
 * o efeito duas vezes, e a segunda leitura achava a URL já limpa e gravava
 * `null` por cima. Por isso o teste monta sob `<React.StrictMode>`.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RedefinirSenhaPage from './page';
import { api } from '../../../lib/fetcher';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock('../../../lib/fetcher', () => ({
  ...jest.requireActual('../../../lib/fetcher'),
  api: jest.fn(async () => undefined),
}));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('RedefinirSenhaPage sob StrictMode', () => {
  it('um link válido abre o formulário, não "Link incompleto"', async () => {
    window.history.replaceState(null, '', '/senha/redefinir?token=abc123');

    render(
      <React.StrictMode>
        <RedefinirSenhaPage />
      </React.StrictMode>,
    );

    expect(await screen.findByText('Escolha uma senha nova')).toBeInTheDocument();
    expect(screen.queryByText('Link incompleto')).toBeNull();
    // E o token continua saindo da barra de endereço.
    expect(window.location.search).toBe('');
  });

  it('o token lido na primeira passada é o que vai para o servidor', async () => {
    window.history.replaceState(null, '', '/senha/redefinir?token=abc123');
    render(
      <React.StrictMode>
        <RedefinirSenhaPage />
      </React.StrictMode>,
    );

    fireEvent.change(await screen.findByLabelText('Senha nova'), {
      target: { value: 'senha-forte-1' },
    });
    fireEvent.change(screen.getByLabelText('Repita a senha nova'), {
      target: { value: 'senha-forte-1' },
    });
    fireEvent.submit(screen.getByLabelText('Senha nova').closest('form')!);

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith(
      '/auth/senha/redefinir',
      expect.objectContaining({ body: { token: 'abc123', novaSenha: 'senha-forte-1' } }),
    );
  });

  it('sem token na URL continua dizendo "Link incompleto"', async () => {
    window.history.replaceState(null, '', '/senha/redefinir');
    render(
      <React.StrictMode>
        <RedefinirSenhaPage />
      </React.StrictMode>,
    );
    expect(await screen.findByText('Link incompleto')).toBeInTheDocument();
  });
});
