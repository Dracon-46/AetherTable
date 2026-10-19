/**
 * Telas de erro — uma tela que lança não pode virar página em branco.
 *
 * Sem `app/error.tsx`, um link como `/?erro=__proto__` (antes da correção)
 * terminava no "Application error" do Next, sem saída além de recarregar.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Erro from './error';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('app/error.tsx', () => {
  it('explica o que houve e "Tentar de novo" chama o reset do Next', () => {
    const reset = jest.fn();
    render(<Erro error={new Error('quebrou')} reset={reset} />);

    expect(screen.getByText('Algo deu errado nesta tela.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tentar de novo'));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('oferece a volta ao início', () => {
    render(<Erro error={new Error('quebrou')} reset={jest.fn()} />);

    expect(screen.getByText('Voltar ao início').closest('a')).toHaveAttribute('href', '/');
  });

  it('registra o erro com o digest, que liga o relato ao log do servidor', () => {
    const erro = Object.assign(new Error('quebrou'), { digest: 'abc123' });
    render(<Erro error={erro} reset={jest.fn()} />);

    expect(console.error).toHaveBeenCalledWith('[erro de tela]', 'abc123', erro);
  });
});
