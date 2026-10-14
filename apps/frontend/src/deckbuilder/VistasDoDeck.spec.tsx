/**
 * VistasDoDeck.spec.tsx — "toquei na carta e ela virou comandante".
 *
 * Os controles da galeria e da vista compacta eram só `opacity-0`: invisíveis,
 * mas recebendo toque. No celular, tocar a arte acertava "Comandante" (no meio
 * da carta) ou o "−" de uma cópia única, e a carta mudava de zona ou sumia sem
 * a pessoa ter visto botão nenhum.
 *
 * O jsdom não faz teste de acerto por `pointer-events`, então a garantia aqui
 * é dupla: a classe que tira o ponteiro do controle escondido está lá, e o
 * caminho de toque (abrir primeiro, agir depois) funciona.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ArteDeCarta, LinhaCompacta, LinhaDeCarta, type AcoesDeCarta } from './VistasDoDeck';
import type { DeckCarta } from './useDecks';

jest.mock(
  'lucide-react',
  () => new Proxy({}, { get: (_alvo, nome) => (nome === '__esModule' ? true : () => null) }),
);

const CARTA: DeckCarta = {
  id: 'c1',
  scryfallId: 'sf-1',
  quantity: 1,
  boardType: 'MAIN',
  name: 'Sol Ring',
  set: 'c21',
};

function acoes(): AcoesDeCarta & { [K in keyof AcoesDeCarta]: jest.Mock } {
  return {
    onMudarQuantidade: jest.fn(),
    onRemover: jest.fn(),
    onAlternarComandante: jest.fn(),
    onTrocarArte: jest.fn(),
  };
}

describe('ArteDeCarta (galeria)', () => {
  it('escondida, a sobreposição não recebe ponteiro', () => {
    render(<ArteDeCarta carta={CARTA} acoes={acoes()} />);
    const sobreposicao = screen.getByTitle('Remover carta').closest('.inset-0')!;

    expect(sobreposicao).toHaveClass('pointer-events-none', 'opacity-0');
    // O hover e o foco devolvem o ponteiro junto com a opacidade.
    expect(sobreposicao).toHaveClass(
      'group-hover/card:pointer-events-auto',
      'focus-within:pointer-events-auto',
    );
  });

  it('o primeiro toque na arte ABRE os controles e não executa ação nenhuma', () => {
    const a = acoes();
    render(<ArteDeCarta carta={CARTA} acoes={a} />);

    fireEvent.click(screen.getByAltText('Sol Ring'));

    for (const acao of Object.values(a)) expect(acao).not.toHaveBeenCalled();
    const sobreposicao = screen.getByTitle('Remover carta').closest('.inset-0')!;
    expect(sobreposicao).toHaveClass('pointer-events-auto', 'opacity-100');
    expect(sobreposicao).not.toHaveClass('pointer-events-none');
  });

  it('aberta, o toque no botão age — e não fecha o painel embaixo do dedo', () => {
    const a = acoes();
    render(<ArteDeCarta carta={CARTA} acoes={a} />);
    fireEvent.click(screen.getByAltText('Sol Ring'));

    fireEvent.click(screen.getByTitle('Aumentar'));

    expect(a.onMudarQuantidade).toHaveBeenCalledWith('c1', 1);
    expect(screen.getByTitle('Remover carta').closest('.inset-0')).toHaveClass('opacity-100');
  });

  it('tocar no fundo da sobreposição aberta fecha', () => {
    render(<ArteDeCarta carta={CARTA} acoes={acoes()} />);
    fireEvent.click(screen.getByAltText('Sol Ring'));
    const sobreposicao = screen.getByTitle('Remover carta').closest('.inset-0')!;

    fireEvent.click(sobreposicao);

    expect(sobreposicao).toHaveClass('pointer-events-none', 'opacity-0');
  });

  it('com mouse, o clique na arte não fixa a sobreposição aberta — quem decide é o hover', () => {
    render(<ArteDeCarta carta={CARTA} acoes={acoes()} />);
    const arte = screen.getByAltText('Sol Ring');

    // O jsdom não tem `PointerEvent`; o React lê só `pointerType` do evento.
    const pressionar = new MouseEvent('pointerdown', { bubbles: true });
    Object.defineProperty(pressionar, 'pointerType', { value: 'mouse' });
    fireEvent(arte, pressionar);
    fireEvent.click(arte);

    expect(screen.getByTitle('Remover carta').closest('.inset-0')).toHaveClass(
      'pointer-events-none',
    );
  });

  it('em modo de leitura não há controle a abrir', () => {
    const leitura: AcoesDeCarta = {
      onMudarQuantidade: null,
      onRemover: null,
      onAlternarComandante: null,
      onTrocarArte: null,
    };
    render(<ArteDeCarta carta={CARTA} acoes={leitura} />);
    fireEvent.click(screen.getByAltText('Sol Ring'));
    expect(screen.queryByTitle('Remover carta')).toBeNull();
  });
});

describe('LinhaCompacta', () => {
  it('controles escondidos não recebem ponteiro; em tela sem hover ficam à vista', () => {
    render(<LinhaCompacta carta={CARTA} acoes={acoes()} />);
    const controles = screen.getByTitle('Diminuir').parentElement!;

    expect(controles).toHaveClass('pointer-events-none', 'opacity-0');
    expect(controles).toHaveClass(
      'group-hover:pointer-events-auto',
      'focus-within:pointer-events-auto',
    );
    // Sem hover (toque), escondê-los seria torná-los inalcançáveis.
    expect(controles).toHaveClass(
      '[@media(hover:none)]:pointer-events-auto',
      '[@media(hover:none)]:opacity-100',
    );
  });
});

describe('quantidade digitável e copiar o nome', () => {
  /** Com só "+" e "−", 30 Relentless Rats eram 29 cliques. */
  it('digitar a quantidade manda a diferença, ao sair do campo', () => {
    const a = acoes();
    render(<LinhaDeCarta carta={{ ...CARTA, quantity: 2 }} acoes={a} />);
    const campo = screen.getByLabelText('Quantidade de Sol Ring');

    fireEvent.change(campo, { target: { value: '30' } });
    expect(a.onMudarQuantidade).not.toHaveBeenCalled();
    fireEvent.blur(campo);
    expect(a.onMudarQuantidade).toHaveBeenCalledWith('c1', 28);
  });

  it('Esc desiste do número digitado', () => {
    const a = acoes();
    render(<LinhaDeCarta carta={CARTA} acoes={a} />);
    const campo = screen.getByLabelText('Quantidade de Sol Ring');

    fireEvent.change(campo, { target: { value: '7' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    fireEvent.blur(campo);
    expect(a.onMudarQuantidade).not.toHaveBeenCalled();
    expect(campo).toHaveValue(1);
  });

  it('copiar o nome funciona mesmo em modo de leitura', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <LinhaCompacta
        carta={CARTA}
        acoes={{
          onMudarQuantidade: null,
          onRemover: null,
          onAlternarComandante: null,
          onTrocarArte: null,
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Copiar o nome de Sol Ring'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Sol Ring'));
  });
});
