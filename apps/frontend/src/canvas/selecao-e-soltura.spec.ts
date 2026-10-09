/**
 * selecao-e-soltura.spec.ts — o laço de seleção e o soltar no campo alheio.
 *
 * Os dois gestos nasceram de relatos: "não consigo selecionar mais de uma
 * carta" (só existia Shift+clique, e no tablet nem isso) e "não consigo jogar
 * carta no campo do outro" (o soltar prendia a carta na faixa de quem
 * arrastava). A geometria é a parte que dá para errar em silêncio — um laço
 * que só pega a carta inteira, ou um ponto na borda que cai na faixa errada.
 */

import {
  cartasNoRetangulo,
  faixaSobPonto,
  montarMesaFocada,
  retanguloEntre,
  type Faixa,
} from './layout';

describe('retanguloEntre', () => {
  it('é o mesmo retângulo em qualquer direção de arraste', () => {
    const esperado = { x: 10, y: 20, largura: 90, altura: 60 };
    expect(retanguloEntre(10, 20, 100, 80)).toEqual(esperado);
    expect(retanguloEntre(100, 80, 10, 20)).toEqual(esperado);
    expect(retanguloEntre(100, 20, 10, 80)).toEqual(esperado);
  });
});

describe('cartasNoRetangulo', () => {
  // Centro em (x, y), como o CardSprite desenha.
  const carta = (id: string, x: number, y: number) => ({ id, x, y, largura: 60, altura: 84 });

  it('pega a carta que o laço TOCA, sem exigir que ela esteja inteira dentro', () => {
    const r = retanguloEntre(0, 0, 40, 40);
    // Centro em (60, 30): a borda esquerda está em 30, dentro do laço.
    expect(cartasNoRetangulo([carta('a', 60, 30)], r)).toEqual(['a']);
  });

  it('deixa de fora a carta que o laço não alcança', () => {
    const r = retanguloEntre(0, 0, 40, 40);
    expect(cartasNoRetangulo([carta('longe', 200, 200)], r)).toEqual([]);
  });

  it('seleciona várias de uma vez, na ordem em que vieram', () => {
    const r = retanguloEntre(0, 0, 500, 100);
    const cartas = [carta('a', 50, 50), carta('b', 150, 50), carta('c', 900, 50)];
    expect(cartasNoRetangulo(cartas, r)).toEqual(['a', 'b']);
  });
});

describe('faixaSobPonto', () => {
  const mesa = montarMesaFocada({
    largura: 1600,
    altura: 900,
    focoId: 'eu',
    oponentes: ['b', 'c', 'd', 'e'],
    trilhoAberto: true,
  });

  it('acha a faixa de um oponente no trilho', () => {
    const faixaB = mesa.faixas.find((f: Faixa) => f.playerId === 'b')!;
    const meio = {
      x: faixaB.esquerda + faixaB.largura / 2,
      y: faixaB.topo + faixaB.altura / 2,
    };
    expect(faixaSobPonto(mesa.faixas, meio.x, meio.y)?.playerId).toBe('b');
  });

  it('acha a minha faixa no meio do meu campo', () => {
    const minha = mesa.faixas.find((f: Faixa) => f.playerId === 'eu')!;
    expect(
      faixaSobPonto(mesa.faixas, minha.esquerda + 10, minha.topo + minha.altura / 2)?.playerId,
    ).toBe('eu');
  });

  it('fora de qualquer faixa devolve null', () => {
    expect(faixaSobPonto(mesa.faixas, -50, -50)).toBeNull();
  });
});
