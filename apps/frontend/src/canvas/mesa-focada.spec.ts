import {
  ALTURA_DE_REFERENCIA,
  CARD_H,
  CARD_W,
  ESCALA_MAX,
  ESCALA_MIN,
  montarMesaFocada,
  posicaoNaMao,
  posicaoNoCampo,
  paraCoordenadaRelativa,
  zonaSolta,
} from './layout';

/**
 * mesa-focada.spec.ts — as regras que o jogador pediu, travadas em teste.
 *
 * O relato foi "as cartas estão muito pequenas e não dá para ler", e a causa
 * era a geometria antiga montar um plano lógico de 1920 e encolher tudo para
 * caber (carta de 48 a 74px num monitor de 1600x950). Estes testes existem para
 * que isso não volte por um refactor que "só mexeu na constante".
 *
 * As duas invariantes de layout que ele foi explícito sobre:
 *   1. a mesa dele ocupa a TELA INTEIRA, sem zoom para se afastar;
 *   2. comando em cima, grimório/cemitério/exílio abaixo, na direita, NUNCA
 *      trocando de lugar.
 */

const TELA = { largura: 1600, altura: 900 };

describe('mesa focada — a carta é legível', () => {
  it('a carta tem ao menos 100px de largura num monitor comum', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    const largura = CARD_W * mesa.faixas[0]!.escala;
    // A geometria antiga entregava 74px aqui. 100 é o piso do legível.
    expect(largura).toBeGreaterThanOrEqual(100);
  });

  it('a carta CRESCE num monitor grande em vez de sobrar espaço', () => {
    const pequeno = montarMesaFocada({ largura: 1366, altura: 700, focoId: 'eu' });
    const grande = montarMesaFocada({ largura: 3440, altura: 1400, focoId: 'eu' });
    expect(grande.faixas[0]!.escala).toBeGreaterThan(pequeno.faixas[0]!.escala);
  });

  it('a escala respeita piso e teto', () => {
    const minusculo = montarMesaFocada({ largura: 600, altura: 300, focoId: 'eu' });
    const gigante = montarMesaFocada({ largura: 6000, altura: 4000, focoId: 'eu' });
    expect(minusculo.faixas[0]!.escala).toBeGreaterThanOrEqual(ESCALA_MIN);
    expect(gigante.faixas[0]!.escala).toBeLessThanOrEqual(ESCALA_MAX);
  });

  it('escala 1 exatamente na altura de referência', () => {
    const mesa = montarMesaFocada({ largura: 1600, altura: ALTURA_DE_REFERENCIA, focoId: 'eu' });
    expect(mesa.faixas[0]!.escala).toBeCloseTo(1, 5);
  });
});

describe('mesa focada — ocupa a tela inteira', () => {
  it('a mesa tem EXATAMENTE o tamanho da área disponível', () => {
    // É isto que elimina o zoom: não existe mesa maior que a tela para
    // "caber", nem menor deixando barra preta.
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    expect(mesa.largura).toBe(TELA.largura);
    expect(mesa.altura).toBe(TELA.altura);
  });

  it('a mão fica na base e dentro da tela', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    expect(mesa.mao.topo + mesa.mao.altura).toBe(mesa.altura);
    expect(mesa.mao.altura).toBeGreaterThan(CARD_H * mesa.faixas[0]!.escala);
  });

  it('o campo mais a coluna preenchem a largura, sem sobra', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    const f = mesa.faixas[0]!;
    const direitaDaColuna = f.comando.x + (CARD_W * f.escala) / 2;
    expect(f.campo.largura).toBeGreaterThan(mesa.largura * 0.7);
    expect(direitaDaColuna).toBeLessThanOrEqual(mesa.largura);
  });

  it('uma carta da mão cabe na tela em qualquer quantidade', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    for (const total of [1, 7, 12, 20]) {
      for (let i = 0; i < total; i++) {
        const p = posicaoNaMao(i, total, mesa);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(mesa.largura);
      }
    }
  });
});

describe('mesa focada — o bloco da direita NUNCA muda', () => {
  const tamanhos = [
    { largura: 1366, altura: 700 },
    { largura: 1600, altura: 900 },
    { largura: 1920, altura: 1080 },
    { largura: 3440, altura: 1440 },
    { largura: 900, altura: 500 },
  ];

  /**
   * ─── A REGRA, NAS PALAVRAS DO JOGADOR ────────────────────────────────────
   *
   * "o grimorio, exilo e cemiterio para a direita e o comandante fica acima
   *  deles, nunca muda, nunca troca"
   *
   * SÓ o comandante fica acima. Os três de pilha ficam LADO A LADO. A primeira
   * versão destes testes afirmava o contrário — que os quatro ficavam na mesma
   * coluna — e por isso o layout errado passou verde. Um teste que afirma a
   * regra errada é pior que teste nenhum: ele defende o defeito.
   */
  it('SÓ o comandante fica acima, e centralizado sobre as pilhas', () => {
    for (const t of tamanhos) {
      const f = montarMesaFocada({ ...t, focoId: 'eu' }).faixas[0]!;
      expect(f.comando.y).toBeLessThan(f.grimorio.y);
      expect(f.comando.y).toBeLessThan(f.cemiterio.y);
      expect(f.comando.y).toBeLessThan(f.exilio.y);
      // Centralizado: o x dele é a média dos extremos da fileira de pilhas.
      expect(f.comando.x).toBeCloseTo((f.grimorio.x + f.exilio.x) / 2, 5);
    }
  });

  it('grimório, cemitério e exílio ficam LADO A LADO, na mesma linha', () => {
    for (const t of tamanhos) {
      const f = montarMesaFocada({ ...t, focoId: 'eu' }).faixas[0]!;
      // Mesma altura: uma fileira, não uma pilha.
      expect(f.grimorio.y).toBe(f.cemiterio.y);
      expect(f.cemiterio.y).toBe(f.exilio.y);
      // E nesta ordem da esquerda para a direita.
      expect(f.grimorio.x).toBeLessThan(f.cemiterio.x);
      expect(f.cemiterio.x).toBeLessThan(f.exilio.x);
    }
  });

  it('as três pilhas NÃO se sobrepõem', () => {
    // Era o sintoma relatado: "por que está uma em cima da outra". Com quatro
    // slots empilhados numa coluna, o passo vertical comprimia e as pilhas se
    // sobrepunham.
    for (const t of tamanhos) {
      const mesa = montarMesaFocada({ ...t, focoId: 'eu' });
      const f = mesa.faixas[0]!;
      // `escalaZonas`: é com ela que a carta do slot é desenhada.
      const largura = CARD_W * f.escalaZonas;
      expect(f.cemiterio.x - f.grimorio.x).toBeGreaterThanOrEqual(largura);
      expect(f.exilio.x - f.cemiterio.x).toBeGreaterThanOrEqual(largura);
    }
  });

  it('a carta do comandante NÃO cobre o rótulo das pilhas', () => {
    /**
     * `Pilha` escreve o nome da zona 16px ACIMA da carta. Sem folga entre a
     * fileira do comandante e a das pilhas, a carta dele cobria essa faixa — e
     * o rótulo que sumia era o do CEMITÉRIO, o do meio, justamente o mais
     * fácil de confundir com os vizinhos. Um retrato da mesa mostrou
     * "GRIMÓRIO" e "EXÍLIO" e nada no meio.
     */
    for (const t of tamanhos) {
      const f = montarMesaFocada({ ...t, focoId: 'eu' }).faixas[0]!;
      const alturaCarta = CARD_H * f.escalaZonas;
      const baseDoComandante = f.comando.y + alturaCarta / 2;
      const rotuloDaPilha = f.grimorio.y - alturaCarta / 2 - 16 * f.escalaZonas;
      expect(rotuloDaPilha).toBeGreaterThan(baseDoComandante);
    }
  });

  it('a reserva fica abaixo das três, fora da fileira', () => {
    for (const t of tamanhos) {
      const f = montarMesaFocada({ ...t, focoId: 'eu' }).faixas[0]!;
      expect(f.reserva.y).toBeGreaterThan(f.grimorio.y);
    }
  });

  it('o bloco inteiro fica na metade direita da tela', () => {
    for (const t of tamanhos) {
      const mesa = montarMesaFocada({ ...t, focoId: 'eu' });
      const f = mesa.faixas[0]!;
      for (const ancora of [f.comando, f.grimorio, f.cemiterio, f.exilio, f.reserva]) {
        expect(ancora.x).toBeGreaterThan(mesa.largura / 2);
      }
    }
  });

  it('o bloco não invade o campo de batalha', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    const f = mesa.faixas[0]!;
    const esquerdaDoBloco = f.grimorio.x - (CARD_W * f.escalaZonas) / 2;
    expect(esquerdaDoBloco).toBeGreaterThanOrEqual(f.campo.x + f.campo.largura - 1);
  });

  it('o bloco cabe dentro da tela, sem estourar a direita', () => {
    for (const t of tamanhos) {
      const mesa = montarMesaFocada({ ...t, focoId: 'eu' });
      const f = mesa.faixas[0]!;
      expect(f.exilio.x + (CARD_W * f.escalaZonas) / 2).toBeLessThanOrEqual(mesa.largura + 1);
      expect(f.reserva.y + (CARD_H * f.escalaZonas) / 2).toBeLessThanOrEqual(mesa.mao.topo + 1);
    }
  });

  it('soltar sobre cada slot acerta a zona daquele slot', () => {
    const f = montarMesaFocada({ ...TELA, focoId: 'eu' }).faixas[0]!;
    expect(zonaSolta(f, f.comando.x, f.comando.y)).toBe('COMMAND');
    expect(zonaSolta(f, f.grimorio.x, f.grimorio.y)).toBe('LIBRARY');
    expect(zonaSolta(f, f.cemiterio.x, f.cemiterio.y)).toBe('GRAVEYARD');
    expect(zonaSolta(f, f.exilio.x, f.exilio.y)).toBe('EXILE');
  });

  it('soltar no meio do campo é campo de batalha', () => {
    const f = montarMesaFocada({ ...TELA, focoId: 'eu' }).faixas[0]!;
    expect(zonaSolta(f, f.campo.largura / 2, f.campo.y + f.campo.altura / 2)).toBe('BATTLEFIELD');
  });
});

describe('mesa focada — trilho dos oponentes', () => {
  const oponentes = ['op1', 'op2', 'op3'];

  it('abrir o trilho NÃO muda a geometria da minha mesa', () => {
    // Foi a escolha explícita do jogador: o trilho flutua por cima, então a
    // carta dele nunca muda de tamanho ao abrir ou fechar.
    const fechado = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes, trilhoAberto: false });
    const aberto = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes, trilhoAberto: true });

    const a = fechado.faixas[0]!;
    const b = aberto.faixas[0]!;
    expect(b.escala).toBe(a.escala);
    expect(b.campo).toEqual(a.campo);
    expect(b.comando).toEqual(a.comando);
    expect(b.grimorio).toEqual(a.grimorio);
    expect(fechado.mao).toEqual(aberto.mao);
  });

  it('recolhido, existe só a minha faixa', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes, trilhoAberto: false });
    expect(mesa.faixas).toHaveLength(1);
    expect(mesa.faixas[0]!.playerId).toBe('eu');
  });

  it('aberto, cada oponente tem faixa própria, na ordem recebida', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes });
    expect(mesa.faixas.map((f) => f.playerId)).toEqual(['eu', 'op1', 'op2', 'op3']);
    // De cima para baixo.
    expect(mesa.faixas[1]!.topo).toBeLessThan(mesa.faixas[2]!.topo);
    expect(mesa.faixas[2]!.topo).toBeLessThan(mesa.faixas[3]!.topo);
  });

  it('o oponente é desenhado PEQUENO, e nunca maior que eu', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes });
    for (const f of mesa.faixas.slice(1)) {
      expect(f.escala).toBeLessThan(mesa.faixas[0]!.escala);
      expect(f.escala).toBeGreaterThan(0);
    }
  });

  it('o trilho fica na direita e não cobre a mão', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes });
    for (const f of mesa.faixas.slice(1)) {
      expect(f.esquerda).toBeGreaterThan(mesa.largura / 2);
      expect(f.topo + f.altura).toBeLessThanOrEqual(mesa.mao.topo + 1);
    }
  });

  it('o bloco do oponente segue o MESMO arranjo do meu', () => {
    // Um arranjo diferente na miniatura obrigaria o jogador a reaprender onde
    // está o cemitério do vizinho.
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu', oponentes });
    for (const f of mesa.faixas.slice(1)) {
      expect(f.comando.y).toBeLessThan(f.grimorio.y);
      expect(f.grimorio.y).toBe(f.cemiterio.y);
      expect(f.cemiterio.y).toBe(f.exilio.y);
      expect(f.grimorio.x).toBeLessThan(f.cemiterio.x);
      expect(f.cemiterio.x).toBeLessThan(f.exilio.x);
    }
  });
});

describe('mesa focada — coordenadas de permanente continuam válidas', () => {
  it('ida e volta preserva a posição dentro do campo', () => {
    const f = montarMesaFocada({ ...TELA, focoId: 'eu' }).faixas[0]!;
    const rel = { x: 200, y: 150 };
    const abs = posicaoNoCampo(f, rel.x, rel.y);
    const volta = paraCoordenadaRelativa(f, abs.x, abs.y);
    expect(volta.x).toBeCloseTo(rel.x, 0);
    expect(volta.y).toBeCloseTo(rel.y, 0);
  });

  it('uma permanente nunca sai do campo, por mais longe que a coordenada esteja', () => {
    const mesa = montarMesaFocada({ ...TELA, focoId: 'eu' });
    const f = mesa.faixas[0]!;
    const meiaL = (CARD_W * f.escala) / 2;
    const meiaA = (CARD_H * f.escala) / 2;
    for (const [x, y] of [
      [-9999, -9999],
      [9999, 9999],
      [0, 0],
    ]) {
      const p = posicaoNoCampo(f, x!, y!);
      expect(p.x - meiaL).toBeGreaterThanOrEqual(f.campo.x - 1);
      expect(p.x + meiaL).toBeLessThanOrEqual(f.campo.x + f.campo.largura + 1);
      expect(p.y - meiaA).toBeGreaterThanOrEqual(f.topo + f.campo.y - 1);
      expect(p.y + meiaA).toBeLessThanOrEqual(f.topo + f.campo.y + f.campo.altura + 1);
    }
  });
});
