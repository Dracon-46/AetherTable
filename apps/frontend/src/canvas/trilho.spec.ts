/**
 * trilho.spec.ts — a mesa dos oponentes em miniatura, e as janelas médias.
 *
 * Três defeitos que a auditoria pegou e que nenhum teste via:
 *
 *   - as permanentes de um oponente, desenhadas no trilho, iam TODAS para a
 *     mesma coluna — a coordenada era pixel do monitor dele, e o campinho do
 *     trilho era menor que uma carta;
 *   - numa janela de 700–1000 px com o trilho aberto o campo ficava negativo, e
 *     as cartas eram desenhadas fora da tela;
 *   - com sete oponentes, a fileira da reserva passava da borda da célula.
 */

import { CARD_W, montarMesaFocada, posicaoNoCampo } from './layout';

const OPONENTES = ['b', 'c', 'd'];

describe('trilho dos oponentes', () => {
  const mesa = montarMesaFocada({
    largura: 1600,
    altura: 900,
    focoId: 'a',
    oponentes: OPONENTES,
  });

  it('o campinho de cada oponente cabe mais de uma carta', () => {
    for (const id of OPONENTES) {
      const f = mesa.porJogador.get(id)!;
      expect(f.campo.largura).toBeGreaterThan(CARD_W * f.escala * 2);
    }
  });

  it('duas permanentes em lugares diferentes da mesa do dono ficam em lugares diferentes', () => {
    const f = mesa.porJogador.get('b')!;
    const esquerda = posicaoNoCampo(f, 0.2, 0.5);
    const direita = posicaoNoCampo(f, 0.8, 0.5);
    expect(direita.x - esquerda.x).toBeGreaterThan(CARD_W * f.escala * 0.5);
  });

  it('a célula de cada oponente comporta as três fileiras de pilhas', () => {
    const cheia = montarMesaFocada({
      largura: 1920,
      altura: 1080,
      focoId: 'a',
      oponentes: ['b', 'c', 'd', 'e', 'f', 'g', 'h'],
    });
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const f = cheia.porJogador.get(id)!;
      expect(f.reserva.y).toBeLessThanOrEqual(f.topo + f.altura);
    }
  });
});

describe('janela média com o trilho aberto', () => {
  it('o campo nunca fica menor que duas cartas — o trilho fecha antes', () => {
    for (const largura of [522, 622, 700, 800]) {
      const mesa = montarMesaFocada({ largura, altura: 646, focoId: 'a', oponentes: OPONENTES });
      const f = mesa.porJogador.get('a')!;
      expect(f.campo.largura).toBeGreaterThanOrEqual(CARD_W * f.escala * 2);
    }
  });

  it('uma permanente nunca é desenhada fora do próprio campo', () => {
    const mesa = montarMesaFocada({ largura: 622, altura: 646, focoId: 'a', oponentes: OPONENTES });
    const f = mesa.porJogador.get('a')!;
    const p = posicaoNoCampo(f, 0.5, 0.5);
    expect(p.x).toBeGreaterThanOrEqual(f.esquerda + f.campo.x);
    expect(p.x).toBeLessThanOrEqual(f.esquerda + f.campo.x + f.campo.largura);
  });
});
