import {
  ALTURA_DE_REFERENCIA,
  CARD_H,
  CARD_W,
  CELULA_DA_GRADE,
  ESCALA_MAX,
  ESCALA_MIN,
  FATOR_CARTA_MAX,
  FATOR_CARTA_MIN,
  FATOR_CARTA_PADRAO,
  encaixarNaGrade,
  escalasDaMesaFocada,
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

/**
 * ─── TAMANHO DA CARTA ESCOLHIDO PELO JOGADOR ───────────────────────────────
 *
 * O fator é um multiplicador sobre a escala automática, e o risco dele é
 * geométrico, não visual: a mão e o rótulo crescem junto com a carta e o campo
 * de batalha é o que sobra. Sem teto, existe um valor de fator em que
 * `campoAltura` fica NEGATIVO — a mesa monta com o campo invertido e as
 * permanentes desaparecem atrás da mão.
 *
 * Estes testes travam as duas metades do contrato: o fator É obedecido enquanto
 * couber, e o campo NUNCA desaparece quando não couber.
 */
describe('mesa focada — fator de tamanho de carta', () => {
  it('sem fator, a geometria é idêntica à de antes do campo existir', () => {
    const semFator = montarMesaFocada({ ...TELA, focoId: 'eu' });
    const comPadrao = montarMesaFocada({ ...TELA, focoId: 'eu', fatorCarta: FATOR_CARTA_PADRAO });
    expect(comPadrao.faixas[0]!.escala).toBeCloseTo(semFator.faixas[0]!.escala, 10);
    expect(comPadrao.mao.topo).toBe(semFator.mao.topo);
  });

  it('aumentar o fator aumenta a carta; reduzir, reduz', () => {
    const base = montarMesaFocada({ ...TELA, focoId: 'eu' }).faixas[0]!.escala;
    const menor = montarMesaFocada({ ...TELA, focoId: 'eu', fatorCarta: 0.6 }).faixas[0]!.escala;
    const maior = montarMesaFocada({ ...TELA, focoId: 'eu', fatorCarta: 1.3 }).faixas[0]!.escala;
    expect(menor).toBeLessThan(base);
    expect(maior).toBeGreaterThan(base);
  });

  it('o fator é obedecido exatamente enquanto a janela permite', () => {
    // Numa janela alta há folga de sobra: 130% tem de sair 130%, e não "o que
    // deu". Um teto conservador demais transformaria o controle em decoração.
    const { pedida, efetiva } = escalasDaMesaFocada(1400, 1.3);
    expect(efetiva).toBeCloseTo(pedida, 10);
  });

  it('o campo de batalha nunca desaparece, nem no fator máximo', () => {
    for (const altura of [420, 500, 700, 900, 1400, 2160]) {
      const mesa = montarMesaFocada({
        largura: 1600,
        altura,
        focoId: 'eu',
        fatorCarta: FATOR_CARTA_MAX,
      });
      const f = mesa.faixas[0]!;
      // Uma carta inteira é o mínimo do mínimo: abaixo disso não existe
      // permanente na mesa, só mão.
      expect(f.campo.altura).toBeGreaterThan(CARD_H * f.escala);
      // E a mão continua dentro da tela.
      expect(mesa.mao.topo + mesa.mao.altura).toBeLessThanOrEqual(altura + 1);
    }
  });

  it('reduzir não tem teto: o piso obedece o jogador', () => {
    // Só o CRESCIMENTO quebra a geometria. Quem pede 50% quer 50%, inclusive
    // numa janela baixa onde o teto já estaria ativo.
    const { pedida, efetiva } = escalasDaMesaFocada(500, FATOR_CARTA_MIN);
    expect(efetiva).toBeCloseTo(pedida, 10);
  });

  it('fator fora da faixa é limitado, não propagado', () => {
    const absurdo = escalasDaMesaFocada(1400, 99).efetiva;
    const maximo = escalasDaMesaFocada(1400, FATOR_CARTA_MAX).efetiva;
    expect(absurdo).toBeCloseTo(maximo, 10);

    const negativo = escalasDaMesaFocada(1400, -3).efetiva;
    const minimo = escalasDaMesaFocada(1400, FATOR_CARTA_MIN).efetiva;
    expect(negativo).toBeCloseTo(minimo, 10);
  });

  it('a permanente continua presa ao campo com o fator no extremo', () => {
    for (const fatorCarta of [FATOR_CARTA_MIN, FATOR_CARTA_MAX]) {
      const f = montarMesaFocada({ ...TELA, focoId: 'eu', fatorCarta }).faixas[0]!;
      const meiaL = (CARD_W * f.escala) / 2;
      const p = posicaoNoCampo(f, 99999, 99999);
      expect(p.x + meiaL).toBeLessThanOrEqual(f.campo.x + f.campo.largura + 1);
    }
  });
});

describe('mesa focada — alinhar à grade', () => {
  const faixa = () => montarMesaFocada({ ...TELA, focoId: 'eu' }).faixas[0]!;

  it('encaixa em múltiplos de meia carta', () => {
    const f = faixa();
    const passoX = CARD_W * f.escala * CELULA_DA_GRADE;
    const passoY = CARD_H * f.escala * CELULA_DA_GRADE;
    const p = encaixarNaGrade(f, { x: 203, y: 147 });
    /**
     * A distância é até a célula MAIS PRÓXIMA, e não o resto da divisão: um
     * resto de 0,994 está a 0,006 célula da próxima, e reprová-lo seria erro
     * do teste, não do encaixe. `encaixarNaGrade` arredonda o resultado para
     * inteiro, então a folga tolerada é de meio pixel.
     */
    const distancia = (v: number, passo: number) => {
      const resto = Math.abs(v / passo) % 1;
      return Math.min(resto, 1 - resto) * passo;
    };
    expect(distancia(p.x, passoX)).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(distancia(p.y, passoY)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('escolhe a célula MAIS PRÓXIMA, e não a anterior', () => {
    const f = faixa();
    const passoX = CARD_W * f.escala * CELULA_DA_GRADE;
    // Logo depois do meio da célula 3: o encaixe tem de subir para a 4.
    const p = encaixarNaGrade(f, { x: passoX * 3.6, y: 0 });
    expect(p.x).toBe(Math.round(passoX * 4));
  });

  it('um ponto já alinhado não se move', () => {
    const f = faixa();
    const passoX = CARD_W * f.escala * CELULA_DA_GRADE;
    const passoY = CARD_H * f.escala * CELULA_DA_GRADE;
    const alvo = { x: Math.round(passoX * 2), y: Math.round(passoY * 2) };
    const p = encaixarNaGrade(f, alvo);
    expect(Math.abs(p.x - alvo.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - alvo.y)).toBeLessThanOrEqual(1);
  });

  it('duas cartas soltas quase no mesmo lugar terminam na MESMA célula', () => {
    // É o ponto do recurso: o desalinho de 3px que lê como descuido desaparece.
    const f = faixa();
    const a = encaixarNaGrade(f, { x: 200, y: 150 });
    const b = encaixarNaGrade(f, { x: 203, y: 147 });
    expect(a).toEqual(b);
  });

  it('o encaixe não empurra a carta para fora do campo', () => {
    const f = faixa();
    const meiaL = (CARD_W * f.escala) / 2;
    const bruta = paraCoordenadaRelativa(f, 99999, 99999);
    const rel = encaixarNaGrade(f, bruta);
    const abs = posicaoNoCampo(f, rel.x, rel.y);
    expect(abs.x + meiaL).toBeLessThanOrEqual(f.campo.x + f.campo.largura + 1);
  });
});
