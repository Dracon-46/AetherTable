/**
 * layout.spec.ts — invariantes da geometria da mesa.
 *
 * O QUE ESTES TESTES PROTEGEM
 *
 * A refatoração que trocou o plano único de 1920x1080 pelas faixas por assento
 * manteve `LARGURA_COMANDO` reservado e manteve `posicaoNoComando` posicionando
 * comandantes ali — mas o desenho da zona de comando se perdeu no caminho, e o
 * GameBoard passou a recriar só as quatro pilhas da direita. Nada quebrou: o
 * typecheck passava, o lint passava, e o layout continuava reservando espaço
 * para uma zona que ninguém mais desenhava.
 *
 * O mesmo silêncio cobria o arrasto. `handleDragEnd` só distinguia mão de
 * campo, então soltar uma carta sobre o cemitério caía no ramo do campo e o
 * clamp de `posicaoNoCampo` a devolvia para o meio da mesa — indistinguível,
 * da cadeira do jogador, de um arrasto que não funciona.
 *
 * Por isso `zonaSolta` mora junto das âncoras, e por isso estes testes casam as
 * duas coisas: mover uma pilha em `montarMesa` sem mover a área de soltura
 * agora falha aqui.
 */

import {
  CARD_H,
  CARD_W,
  ESPACO_ENTRE_FAIXAS,
  colunasDaGrade,
  escalaDaFaixa,
  montarGrade,
  montarMesa,
  posicaoNoCampo,
  posicaoNoComando,
  paraCoordenadaRelativa,
  zonaSolta,
} from './layout';

const desktop = () => montarMesa(['op2', 'op1', 'op0', 'eu'], 'eu');
const estreito = () => montarMesa(['eu'], 'eu', { estreito: true });

const cenarios = [
  { nome: 'desktop, 4 assentos', mesa: desktop() },
  { nome: 'tela estreita', mesa: estreito() },
];

describe('zona de comando', () => {
  it.each(cenarios)('$nome: o slot cabe na faixa reservada', ({ mesa }) => {
    for (const faixa of mesa.faixas) {
      const esc = escalaDaFaixa(faixa.emFoco);
      const meiaLargura = (CARD_W * esc) / 2;
      const meiaAltura = (CARD_H * esc) / 2;

      // O comando vive na ponta DIREITA: não pode invadir o campo de batalha,
      // que termina em `campo.x + campo.largura`...
      expect(faixa.comando.x - meiaLargura).toBeGreaterThanOrEqual(
        faixa.campo.x + faixa.campo.largura,
      );
      // ...nem vazar pela borda direita da mesa.
      expect(faixa.comando.x + meiaLargura).toBeLessThanOrEqual(faixa.largura);

      // E tem de caber verticalmente na própria faixa.
      expect(faixa.comando.y - meiaAltura).toBeGreaterThanOrEqual(faixa.topo);
      expect(faixa.comando.y + meiaAltura).toBeLessThanOrEqual(faixa.topo + faixa.altura);
    }
  });

  it('comandantes parceiros se abrem em leque a partir da âncora', () => {
    const faixa = montarMesa(['eu'], 'eu').faixas[0]!;
    const primeiro = posicaoNoComando(0, faixa.comando);
    const segundo = posicaoNoComando(1, faixa.comando);

    expect(primeiro).toEqual(faixa.comando);
    // Deslocado o bastante para revelar a carta de baixo, perto o bastante para
    // continuar lendo como uma pilha só.
    expect(segundo.x).toBeGreaterThan(primeiro.x);
    expect(segundo.y).toBeLessThan(primeiro.y);
  });
});

describe('zonas fixas ancoradas na base', () => {
  // O pedido era explícito: comando, grimório, cemitério e exílio "mais para
  // baixo". Antes ficavam em `altura / 2`, o que numa faixa em foco — três
  // fileiras de altura — as deixava na mesma linha das criaturas.
  it.each(cenarios)('$nome: ficam na metade de baixo da faixa', ({ mesa }) => {
    for (const faixa of mesa.faixas) {
      const meio = faixa.topo + faixa.altura / 2;
      for (const ancora of [faixa.comando, faixa.grimorio, faixa.cemiterio, faixa.exilio]) {
        expect(ancora.y).toBeGreaterThan(meio);
      }
    }
  });

  it.each(cenarios)('$nome: nenhuma zona fixa transborda a faixa', ({ mesa }) => {
    for (const faixa of mesa.faixas) {
      const meiaAltura = (CARD_H * escalaDaFaixa(faixa.emFoco)) / 2;
      for (const ancora of [
        faixa.comando,
        faixa.grimorio,
        faixa.cemiterio,
        faixa.exilio,
        faixa.reserva,
      ]) {
        expect(ancora.y - meiaAltura).toBeGreaterThanOrEqual(faixa.topo);
        // Folga extra embaixo: cada pilha desenha o contador abaixo da carta.
        expect(ancora.y + meiaAltura).toBeLessThanOrEqual(faixa.topo + faixa.altura - 9);
      }
    }
  });
});

describe('zonaSolta', () => {
  it('soltar sobre o slot de comando manda para a zona de comando', () => {
    for (const { mesa } of cenarios) {
      for (const faixa of mesa.faixas) {
        expect(zonaSolta(faixa, faixa.comando.x, faixa.comando.y)).toBe('COMMAND');
      }
    }
  });

  /**
   * ─── A COLUNA INTEIRA NÃO PERTENCE MAIS À ZONA ───────────────────────────
   *
   * Antes, tudo que caísse fora do retângulo do campo era atribuído à âncora
   * MAIS PRÓXIMA — sem limite de distância. O canto superior direito, a dez
   * pixels do topo da faixa, virava zona de comando; a margem esquerda virava
   * exílio. O jogador soltava a carta perto de uma borda e ela sumia da mesa
   * para uma zona que nada na tela tinha indicado.
   *
   * Agora o destino padrão é o inofensivo: não acertou um slot, é campo — e o
   * clamp de `posicaoNoCampo` traz a carta de volta para dentro.
   */
  it('soltar LONGE de qualquer slot é campo, não a zona mais próxima', () => {
    for (const { mesa } of cenarios) {
      for (const faixa of mesa.faixas) {
        // Canto superior direito: era COMMAND por proximidade.
        expect(zonaSolta(faixa, faixa.esquerda + faixa.largura, faixa.topo + 10)).toBe(
          'BATTLEFIELD',
        );
        // Canto superior esquerdo: era LIBRARY por proximidade.
        expect(zonaSolta(faixa, faixa.esquerda, faixa.topo + 10)).toBe('BATTLEFIELD');
      }
    }
  });

  /**
   * A COLUNA de um slot não pertence a ele.
   *
   * Este é o caso que produzia o sumiço: a carta era solta no alto da faixa,
   * alinhada com uma pilha, e ia parar nela. Alinhamento horizontal não é
   * intenção — o jogador tem de soltar SOBRE o slot.
   *
   * A altura escolhida é o topo da faixa porque ela é a mesma nos três
   * arranjos: no estreito as pilhas ficam em 2x2, então "uma carta acima do
   * exílio" é o grimório, e a asserção precisaria conhecer o arranjo.
   */
  it('estar alinhado com um slot não basta: a coluna dele não é dele', () => {
    for (const { mesa } of cenarios) {
      for (const faixa of mesa.faixas) {
        expect(zonaSolta(faixa, faixa.exilio.x, faixa.topo + 10)).toBe('BATTLEFIELD');
        expect(zonaSolta(faixa, faixa.grimorio.x, faixa.topo + 10)).toBe('BATTLEFIELD');
        expect(zonaSolta(faixa, faixa.comando.x, faixa.topo + 10)).toBe('BATTLEFIELD');
      }
    }
  });

  /**
   * O pedido era o canto INFERIOR ESQUERDO para grimório, cemitério e exílio.
   * Sem esta trava, mover as âncoras de volta para a direita passaria batido:
   * o desenho segue as âncoras e `zonaSolta` segue as âncoras, então nada mais
   * no código acusaria a troca de lado.
   */
  it.each(cenarios)('$nome: as pilhas ficam à esquerda e o comando à direita', ({ mesa }) => {
    for (const faixa of mesa.faixas) {
      for (const ancora of [faixa.grimorio, faixa.cemiterio, faixa.exilio, faixa.reserva]) {
        expect(ancora.x).toBeLessThan(faixa.campo.x);
      }
      expect(faixa.comando.x).toBeGreaterThan(faixa.campo.x + faixa.campo.largura);
    }
  });

  it('o miolo é o campo de batalha', () => {
    for (const { mesa } of cenarios) {
      for (const faixa of mesa.faixas) {
        const meioDoCampo = faixa.campo.x + faixa.campo.largura / 2;
        expect(zonaSolta(faixa, meioDoCampo, faixa.topo + 40)).toBe('BATTLEFIELD');
        // As bordas exatas do campo continuam sendo campo.
        expect(zonaSolta(faixa, faixa.campo.x, faixa.topo + 40)).toBe('BATTLEFIELD');
        expect(zonaSolta(faixa, faixa.campo.x + faixa.campo.largura, faixa.topo + 40)).toBe(
          'BATTLEFIELD',
        );
      }
    }
  });

  it.each(cenarios)('$nome: cada pilha recebe o que é solto sobre ela', ({ mesa }) => {
    for (const faixa of mesa.faixas) {
      expect(zonaSolta(faixa, faixa.grimorio.x, faixa.grimorio.y)).toBe('LIBRARY');
      expect(zonaSolta(faixa, faixa.cemiterio.x, faixa.cemiterio.y)).toBe('GRAVEYARD');
      expect(zonaSolta(faixa, faixa.exilio.x, faixa.exilio.y)).toBe('EXILE');
    }
  });

  it('a reserva nunca é destino de arrasto', () => {
    // É zona oculta: cair nela por imprecisão sumiria com a carta da mesa.
    //
    // Antes o arrasto sobre a reserva era desviado para a pilha vizinha — o que
    // resolvia o sumiço, mas mandava a carta para um lugar que o jogador também
    // não pediu. Agora cai no campo, que é onde ela fica VISÍVEL e de onde dá
    // para tentar de novo.
    for (const { mesa } of cenarios) {
      for (const faixa of mesa.faixas) {
        expect(zonaSolta(faixa, faixa.reserva.x, faixa.reserva.y)).toBe('BATTLEFIELD');
      }
    }
  });
});

describe('coordenadas do campo', () => {
  it('ida e volta preserva a posição dentro do campo', () => {
    const faixa = desktop().faixas[3]!;
    const absoluta = posicaoNoCampo(faixa, 200, 90);
    const relativa = paraCoordenadaRelativa(faixa, absoluta.x, absoluta.y);

    expect(relativa.x).toBe(200);
    expect(relativa.y).toBe(90);
  });

  it('uma carta solta no campo nunca aterrissa sobre a zona de comando', () => {
    for (const faixa of desktop().faixas) {
      const bemAEsquerda = posicaoNoCampo(faixa, -500, 40);
      /**
       * A meia-largura é a DESENHADA, com a escala da faixa.
       *
       * Esta assertiva usava `CARD_W / 2` cru, e com isso codificava um bug do
       * `posicaoNoCampo`: ele também ignorava a escala. Numa faixa fora de foco
       * (escala 0,62) a carta é desenhada com 74px de largura, não 120 — exigir
       * 60px de folga parava a carta 23px antes da borda e criava uma margem
       * morta que o jogador não conseguia usar. O erro passou porque o teste e
       * o código estavam errados da mesma forma.
       */
      const meiaLargura = (CARD_W * faixa.escala) / 2;
      expect(bemAEsquerda.x - meiaLargura).toBeGreaterThanOrEqual(faixa.campo.x);
    }
  });

  it('a faixa em foco é mais alta que as demais', () => {
    const { porJogador } = desktop();
    expect(porJogador.get('eu')!.altura).toBeGreaterThan(porJogador.get('op0')!.altura);
  });
});

/**
 * As faixas eram desenhadas encostadas, e o resultado lia como UMA superfície
 * listrada: não havia como dizer onde terminava a mesa de um jogador e começava
 * a do vizinho. Uma carta na borda inferior da faixa de cima parecia estar na
 * borda superior da de baixo.
 */
describe('separação entre mesas', () => {
  it('existe um respiro entre uma faixa e a seguinte', () => {
    const { faixas } = desktop();

    for (let i = 1; i < faixas.length; i += 1) {
      const anterior = faixas[i - 1]!;
      const atual = faixas[i]!;
      const vao = atual.topo - (anterior.topo + anterior.altura);
      expect(vao).toBe(ESPACO_ENTRE_FAIXAS);
    }
  });

  it('nenhuma faixa invade a área da seguinte', () => {
    const { faixas } = desktop();

    for (let i = 1; i < faixas.length; i += 1) {
      expect(faixas[i]!.topo).toBeGreaterThan(faixas[i - 1]!.topo + faixas[i - 1]!.altura);
    }
  });

  it('não sobra folga órfã entre a última faixa e a mão', () => {
    const mesa = desktop();
    const ultima = mesa.faixas[mesa.faixas.length - 1]!;
    expect(mesa.mao.topo).toBe(ultima.topo + ultima.altura);
  });
});

/**
 * "Minha mesa" e "Mesa de Fulano" mudavam só o FOCO: todas as faixas
 * continuavam desenhadas, empilhadas. Ver uma mesa só é montar a mesa com um
 * assento — não existe modo à parte para isso.
 */
describe('mesa de um assento só', () => {
  const sozinho = () => montarMesa(['eu'], 'eu');

  it('desenha uma faixa e nenhuma outra', () => {
    expect(sozinho().faixas).toHaveLength(1);
  });

  it('a faixa única fica em foco e é bem mais baixa que a mesa de quatro', () => {
    const uma = sozinho();
    expect(uma.faixas[0]!.emFoco).toBe(true);
    expect(uma.altura).toBeLessThan(desktop().altura);
  });

  it('a mão continua na base, logo abaixo da faixa', () => {
    const uma = sozinho();
    expect(uma.mao.topo).toBe(uma.faixas[0]!.topo + uma.faixas[0]!.altura);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('montarGrade — a visão "todos" em quadrados', () => {
  it('as células são QUADRADAS', () => {
    for (const n of [2, 3, 4, 6, 8]) {
      const ordem = Array.from({ length: n }, (_, i) => `p${i}`);
      const mesa = montarGrade(ordem, 'p0');
      for (const faixa of mesa.faixas) {
        expect(faixa.largura).toBe(faixa.altura);
      }
    }
  });

  it('a grade cresce pela raiz: 2→2col, 4→2col, 6→3col, 9→3col', () => {
    expect(colunasDaGrade(2)).toBe(2);
    expect(colunasDaGrade(3)).toBe(2);
    expect(colunasDaGrade(4)).toBe(2);
    expect(colunasDaGrade(5)).toBe(3);
    expect(colunasDaGrade(6)).toBe(3);
    expect(colunasDaGrade(9)).toBe(3);
  });

  it('nenhuma célula se sobrepõe a outra', () => {
    const ordem = Array.from({ length: 6 }, (_, i) => `p${i}`);
    const { faixas } = montarGrade(ordem, 'p0');

    for (let i = 0; i < faixas.length; i += 1) {
      for (let j = i + 1; j < faixas.length; j += 1) {
        const a = faixas[i]!;
        const b = faixas[j]!;
        const separadas =
          a.esquerda + a.largura <= b.esquerda ||
          b.esquerda + b.largura <= a.esquerda ||
          a.topo + a.altura <= b.topo ||
          b.topo + b.altura <= a.topo;
        expect(separadas).toBe(true);
      }
    }
  });

  it('as células cabem na largura da mesa', () => {
    for (const n of [2, 3, 4, 6, 8]) {
      const ordem = Array.from({ length: n }, (_, i) => `p${i}`);
      const mesa = montarGrade(ordem, 'p0');
      for (const faixa of mesa.faixas) {
        expect(faixa.esquerda).toBeGreaterThanOrEqual(0);
        expect(faixa.esquerda + faixa.largura).toBeLessThanOrEqual(mesa.largura);
      }
    }
  });

  /**
   * Na grade as células são iguais por definição: o foco vira cor de borda, não
   * tamanho. Se o foco mexesse na escala, a grade deixaria de ser grade.
   */
  it('todas as células têm a MESMA escala, inclusive a em foco', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'b');
    const escalas = new Set(mesa.faixas.map((f) => f.escala));
    expect(escalas.size).toBe(1);
    expect(mesa.faixas.find((f) => f.playerId === 'b')!.emFoco).toBe(true);
  });

  it('as zonas ficam na fileira do rodapé, dentro da célula', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'a');
    for (const faixa of mesa.faixas) {
      for (const ancora of [faixa.comando, faixa.grimorio, faixa.cemiterio, faixa.exilio]) {
        expect(ancora.x).toBeGreaterThan(faixa.esquerda);
        expect(ancora.x).toBeLessThan(faixa.esquerda + faixa.largura);
        expect(ancora.y).toBeGreaterThan(faixa.zonas.topo);
        expect(ancora.y).toBeLessThan(faixa.topo + faixa.altura);
      }
      // O campo não invade a fileira de zonas.
      expect(faixa.topo + faixa.campo.y + faixa.campo.altura).toBeLessThanOrEqual(faixa.zonas.topo);
    }
  });

  it('soltar no meio da célula é campo; sobre a âncora é a zona dela', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'a');
    for (const faixa of mesa.faixas) {
      const meio = {
        x: faixa.esquerda + faixa.campo.x + faixa.campo.largura / 2,
        y: faixa.topo + faixa.campo.y + faixa.campo.altura / 2,
      };
      expect(zonaSolta(faixa, meio.x, meio.y)).toBe('BATTLEFIELD');
      expect(zonaSolta(faixa, faixa.grimorio.x, faixa.grimorio.y)).toBe('LIBRARY');
      expect(zonaSolta(faixa, faixa.cemiterio.x, faixa.cemiterio.y)).toBe('GRAVEYARD');
      expect(zonaSolta(faixa, faixa.exilio.x, faixa.exilio.y)).toBe('EXILE');
      expect(zonaSolta(faixa, faixa.comando.x, faixa.comando.y)).toBe('COMMAND');
    }
  });

  it('ida e volta da coordenada preserva a posição DENTRO da célula certa', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'a');
    // A célula `d` é a que mais longe está da origem: se a origem da célula for
    // esquecida em algum dos dois sentidos, é aqui que aparece.
    const faixa = mesa.porJogador.get('d')!;
    // (0,0) fica de fora de propósito: é o caso especial de "carta sem
    // coordenada", que `posicaoNoCampo` CENTRALIZA na célula em vez de encostar
    // no canto. A ida e volta ali não é identidade — e não deve ser.
    for (const ponto of [
      { x: 40, y: 90 },
      { x: faixa.campo.largura - CARD_W, y: faixa.campo.altura - CARD_H },
    ]) {
      const tela = posicaoNoCampo(faixa, ponto.x, ponto.y);
      expect(tela.x).toBeGreaterThan(faixa.esquerda);
      expect(tela.x).toBeLessThan(faixa.esquerda + faixa.largura);
      const volta = paraCoordenadaRelativa(faixa, tela.x, tela.y);
      expect(Math.abs(volta.x - ponto.x)).toBeLessThanOrEqual(CARD_W);
      expect(Math.abs(volta.y - ponto.y)).toBeLessThanOrEqual(CARD_H);
    }
  });

  it('carta sem coordenada nasce no CENTRO da própria célula, não no canto', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'a');
    const faixa = mesa.porJogador.get('d')!;

    const tela = posicaoNoCampo(faixa, 0, 0);

    expect(tela.x).toBeCloseTo(faixa.esquerda + faixa.campo.x + faixa.campo.largura / 2, 0);
    expect(tela.y).toBeCloseTo(faixa.topo + faixa.campo.y + faixa.campo.altura / 2, 0);
  });

  it('a mão continua numa faixa própria, abaixo da grade', () => {
    const mesa = montarGrade(['a', 'b', 'c', 'd'], 'a');
    const ultimaLinha = Math.max(...mesa.faixas.map((f) => f.topo + f.altura));
    expect(mesa.mao.topo).toBeGreaterThanOrEqual(ultimaLinha);
    expect(mesa.altura).toBe(mesa.mao.topo + mesa.mao.altura);
  });
});
