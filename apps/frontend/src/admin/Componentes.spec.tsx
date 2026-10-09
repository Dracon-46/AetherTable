/**
 * DialogoDeAcao — o erro da ação ANTERIOR reabria junto.
 *
 * `erro` vem da mutação do chamador, que sobrevive ao diálogo: uma ação que
 * falhou com 403, fechada, e a próxima abertura já nascia dizendo "Você não
 * tem permissão para isso" antes de qualquer clique.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DialogoDeAcao } from './Componentes';
import { ApiError } from '../lib/fetcher';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const PROIBIDO = new ApiError('Forbidden', 403);
const TEXTO_DO_ERRO = 'Você não tem permissão para isso.';

function Dialogo(props: { aberto: boolean; erro?: unknown; onConfirmar?: () => void }) {
  return (
    <DialogoDeAcao
      aberto={props.aberto}
      titulo="Suspender conta"
      descricao="A pessoa não consegue entrar até o prazo vencer."
      rotuloConfirmar="Suspender"
      erro={props.erro}
      onConfirmar={props.onConfirmar ?? (() => {})}
      onCancelar={() => {}}
    />
  );
}

function confirmar() {
  fireEvent.change(screen.getByPlaceholderText('Por que esta ação está sendo tomada?'), {
    target: { value: 'reincidência confirmada' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Suspender' }));
}

describe('DialogoDeAcao', () => {
  it('ao abrir, não mostra o erro que a mutação trazia de antes', () => {
    render(<Dialogo aberto erro={PROIBIDO} />);
    expect(screen.queryByText(TEXTO_DO_ERRO)).toBeNull();
  });

  it('depois de confirmar NESTA abertura, o erro aparece', () => {
    const onConfirmar = jest.fn();
    render(<Dialogo aberto erro={PROIBIDO} onConfirmar={onConfirmar} />);

    confirmar();

    expect(onConfirmar).toHaveBeenCalled();
    expect(screen.getByText(TEXTO_DO_ERRO)).toBeInTheDocument();
  });

  it('fechar e reabrir esconde de novo o erro antigo', () => {
    const { rerender } = render(<Dialogo aberto erro={PROIBIDO} />);
    confirmar();
    expect(screen.getByText(TEXTO_DO_ERRO)).toBeInTheDocument();

    rerender(<Dialogo aberto={false} erro={PROIBIDO} />);
    rerender(<Dialogo aberto erro={PROIBIDO} />);

    expect(screen.queryByText(TEXTO_DO_ERRO)).toBeNull();
  });
});
