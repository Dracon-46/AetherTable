/**
 * Cadastro — a recusa de validação dizia só "Dados inválidos.".
 *
 * O `ZodValidationPipe` manda a regra que falhou em `erros[]` (senha curta,
 * caractere proibido no nome de usuário) e a tela lia só o `message`
 * genérico: a pessoa não tinha como saber o que corrigir.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RegisterPage from './page';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock('../CenaDoDragao', () => ({
  CenaDoDragao: () => null,
  useDragao: () => ({
    fase: 'repouso',
    carregar: jest.fn(),
    relaxar: jest.fn(),
    cuspir: jest.fn(),
  }),
}));
// O servidor "já está acordado": o teste é sobre a resposta do cadastro.
jest.mock('../../net/wake', () => ({
  ...jest.requireActual('../../net/wake'),
  acordarApi: jest.fn(async () => true),
}));

it('mostra a regra que falhou, não "Dados inválidos."', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 400,
    headers: { get: () => null },
    json: async () => ({
      message: 'Dados inválidos.',
      erros: [{ campo: 'password', erro: 'A senha precisa de ao menos 8 caracteres' }],
    }),
  })) as unknown as typeof fetch;

  render(<RegisterPage />);
  fireEvent.change(screen.getByPlaceholderText('Jace Beleren'), { target: { value: 'jace' } });
  fireEvent.change(screen.getByPlaceholderText('seuemail@exemplo.com'), {
    target: { value: 'jace@exemplo.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••••••'), { target: { value: 'curta' } });
  fireEvent.submit(screen.getByPlaceholderText('Jace Beleren').closest('form')!);

  expect(
    await screen.findByText('Senha: A senha precisa de ao menos 8 caracteres'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Dados inválidos.')).toBeNull();
});
