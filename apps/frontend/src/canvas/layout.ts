/**
 * layout.ts — geometria da mesa.
 *
 * ─── O PROBLEMA QUE ESTA VERSÃO RESOLVE ────────────────────────────────────
 *
 * A mesa era UM plano de 1920x1080 compartilhado por todos. As coordenadas de
 * `Card.x/y` do campo de batalha eram absolutas e globais, então duas pessoas
 * podiam soltar permanentes exatamente em cima uma da outra — e num jogo de
 * quatro, isso acontece em menos de um turno. Também não havia nenhuma noção de
 * "o meu lado da mesa": o comandante do oponente, o cemitério dele e as minhas
 * criaturas disputavam o mesmo espaço.
 *
 * ─── COMO É AGORA ──────────────────────────────────────────────────────────
 *
 * A mesa é dividida em FAIXAS, uma por assento — como uma mesa física de EDH
 * vista de cima. A minha faixa fica embaixo (é onde estão minhas mãos); as dos
 * oponentes ficam acima, em ordem de assento.
 *
 *   ┌──────────────────────────────────────────┐
 *   │ oponente 2   [cmd] campo …    [pilhas]   │  ← faixa
 *   ├──────────────────────────────────────────┤
 *   │ oponente 1   [cmd] campo …    [pilhas]   │
 *   ├──────────────────────────────────────────┤
 *   │ EU          [cmd] campo …     [pilhas]   │  ← faixa em foco (maior)
 *   ├──────────────────────────────────────────┤
 *   │ minha mão                                │
 *   └──────────────────────────────────────────┘
 *
 * `Card.x/y` de uma permanente passa a ser RELATIVO à faixa de quem a controla.
 * Isso é o que torna a colisão entre jogadores impossível por construção, em
 * vez de "improvável se todo mundo tomar cuidado".
 *
 * A faixa em foco (a minha, ou a de um oponente selecionado no painel de
 * Câmera) recebe mais altura: numa mesa de seis, sem isso, ninguém enxerga
 * carta nenhuma.
 */

export const LOGICAL_W = 1920;

/**
 * Largura lógica em telas estreitas.
 *
 * Encaixar 1920 numa tela de 390px dá escala 0,19: a carta fica com 23px e
 * ninguém joga assim. A conta que importa é a inversa — quantas cartas
 * precisam caber lado a lado para o jogo funcionar (~6) — e daí sai a largura.
 * O que sobra vira rolagem vertical, não miniatura.
 */
export const LOGICAL_W_ESTREITO = 900;

export const CARD_W = 120;
export const CARD_H = Math.round(CARD_W * 1.396);

/** Altura da faixa de mão na base da mesa. */
export const HAND_H = CARD_H + 32;

/** Altura de uma faixa fora de foco: cabe uma fileira de cartas. */
export const FAIXA_H = CARD_H + 56;
/** A faixa em foco cabe três fileiras — é onde o jogo realmente acontece. */
export const FAIXA_FOCO_H = CARD_H * 3 + 80;

/** Quanto uma faixa fora de foco encolhe. */
export const ESCALA_FORA_DE_FOCO = 0.72;
/**
 * Escala das cartas de uma faixa. Exportada porque o GameBoard precisa da
 * MESMA conta: com o número solto nos dois lados, mover uma âncora aqui
 * deslocava o desenho lá sem que nada acusasse.
 */
export const escalaDaFaixa = (emFoco: boolean) => (emFoco ? 1 : ESCALA_FORA_DE_FOCO);

/**
 * Folga entre a base da faixa e a borda inferior das zonas fixas. Precisa caber
 * o contador que cada pilha desenha logo abaixo da carta.
 */
const MARGEM_BASE = 20;

/** Reservado à esquerda de cada faixa para a zona de comando. */
export const LARGURA_COMANDO = CARD_W + 48;
/**
 * Reservado à direita para as pilhas.
 *
 * Em fileira única, quatro pilhas comem 560px — 29% da mesa só para grimório,
 * cemitério, exílio e reserva. Em tela estreita elas passam a ocupar uma grade
 * 2x2, que custa metade da largura pelo dobro da altura.
 */
export const LARGURA_PILHAS = 4 * (CARD_W + 14) + 24;
export const LARGURA_PILHAS_GRADE = 2 * (CARD_W + 14) + 24;

export interface Ponto {
  x: number;
  y: number;
}

export interface Faixa {
  /** sessionId do dono da faixa. */
  playerId: string;
  topo: number;
  altura: number;
  emFoco: boolean;
  /** Retângulo livre para permanentes, em coordenadas RELATIVAS à faixa. */
  campo: { x: number; y: number; largura: number; altura: number };
  /** Âncoras absolutas das zonas de pilha desta faixa. */
  comando: Ponto;
  grimorio: Ponto;
  cemiterio: Ponto;
  exilio: Ponto;
  reserva: Ponto;
  /** Onde escrever o nome e a vida do jogador. */
  rotulo: Ponto;
}

export interface Mesa {
  /** Largura lógica desta mesa — muda entre desktop e tela estreita. */
  largura: number;
  altura: number;
  faixas: Faixa[];
  porJogador: Map<string, Faixa>;
  /** Faixa de mão do jogador local, sempre na base. */
  mao: { topo: number; altura: number };
}

export interface OpcoesMesa {
  /** Tela estreita: uma faixa por vez, pilhas em grade 2x2. */
  estreito?: boolean;
}

/**
 * Monta a geometria da mesa.
 *
 * `ordem` deve começar pelos oponentes (de cima para baixo) e terminar no
 * jogador local — a faixa de baixo é sempre a de quem está olhando, como numa
 * mesa de verdade.
 */
export function montarMesa(ordem: string[], focoId: string, opcoes: OpcoesMesa = {}): Mesa {
  const estreito = opcoes.estreito === true;
  const largura = estreito ? LOGICAL_W_ESTREITO : LOGICAL_W;
  const larguraPilhas = estreito ? LARGURA_PILHAS_GRADE : LARGURA_PILHAS;
  const larguraComando = estreito ? CARD_W + 20 : LARGURA_COMANDO;

  const faixas: Faixa[] = [];
  let y = 0;

  for (const playerId of ordem) {
    const emFoco = playerId === focoId;
    // Em tela estreita só existe a faixa em foco, e ela ganha altura extra
    // porque as pilhas passam a ocupar duas fileiras.
    const altura = estreito ? FAIXA_FOCO_H + CARD_H : emFoco ? FAIXA_FOCO_H : FAIXA_H;

    const campoX = larguraComando;
    const campoLargura = largura - larguraComando - larguraPilhas;
    const campoY = 26;
    const campoAltura = altura - campoY - 10;

    const alturaCarta = CARD_H * escalaDaFaixa(emFoco);

    /**
     * Âncora vertical das zonas fixas — comando e pilhas.
     *
     * Antes era `altura / 2`. Numa faixa em foco, que tem três fileiras de
     * altura, isso deixava grimório, cemitério e exílio boiando no meio do
     * nada, na mesma linha das criaturas. A leitura natural de uma mesa é o
     * campo em cima e as zonas paradas embaixo; ancorar na base também alinha
     * as pilhas com a faixa de mão, que já vive no rodapé.
     */
    const base = y + altura - alturaCarta / 2 - MARGEM_BASE;

    const pilhaX = largura - larguraPilhas + 24;
    const col = (i: number) => pilhaX + CARD_W / 2 + i * (CARD_W + 14);
    /** Grade 2x2 do modo estreito: a fileira 1 é a que encosta na base. */
    const linha = (i: number) => base - (1 - i) * (alturaCarta + 22);

    faixas.push({
      playerId,
      topo: y,
      altura,
      emFoco,
      campo: { x: campoX, y: campoY, largura: campoLargura, altura: campoAltura },
      comando: { x: larguraComando / 2 + 8, y: base },
      grimorio: estreito ? { x: col(0), y: linha(0) } : { x: col(0), y: base },
      cemiterio: estreito ? { x: col(1), y: linha(0) } : { x: col(1), y: base },
      exilio: estreito ? { x: col(0), y: linha(1) } : { x: col(2), y: base },
      reserva: estreito ? { x: col(1), y: linha(1) } : { x: col(3), y: base },
      rotulo: { x: 12, y: y + 6 },
    });

    y += altura;
  }

  return {
    largura,
    altura: y + HAND_H,
    faixas,
    porJogador: new Map(faixas.map((f) => [f.playerId, f])),
    mao: { topo: y, altura: HAND_H },
  };
}

/**
 * Converte a posição relativa de uma permanente na posição absoluta da mesa,
 * mantendo-a dentro do campo da faixa.
 *
 * O clamp não é cosmético: sem ele, uma carta arrastada para fora aterrissaria
 * na faixa do vizinho e passaria a parecer dele.
 */
export function posicaoNoCampo(faixa: Faixa, x: number, y: number): Ponto {
  const { campo } = faixa;
  const minX = campo.x + CARD_W / 2;
  const maxX = campo.x + campo.largura - CARD_W / 2;
  const minY = faixa.topo + campo.y + CARD_H / 2;
  const maxY = faixa.topo + campo.y + campo.altura - CARD_H / 2;

  // Uma carta jogada por INTENT_CHANGE_ZONE sem coordenada chega em (0,0):
  // centraliza em vez de empilhar tudo no canto superior esquerdo.
  const bruta =
    x === 0 && y === 0
      ? { x: campo.x + campo.largura / 2, y: faixa.topo + campo.y + campo.altura / 2 }
      : { x: campo.x + x, y: faixa.topo + campo.y + y };

  return {
    x: Math.min(maxX, Math.max(minX, bruta.x)),
    y: Math.min(maxY, Math.max(minY, bruta.y)),
  };
}

/** Inverso de `posicaoNoCampo`: da tela lógica para o que vai ao servidor. */
export function paraCoordenadaRelativa(faixa: Faixa, x: number, y: number): Ponto {
  const { campo } = faixa;
  return {
    x: Math.round(Math.min(campo.largura, Math.max(0, x - campo.x))),
    y: Math.round(Math.min(campo.altura, Math.max(0, y - faixa.topo - campo.y))),
  };
}

/**
 * Leque da mão: centraliza e comprime o espaçamento quando há muitas cartas,
 * para que 12+ cartas não saiam pela borda.
 */
export function posicaoNaMao(indice: number, total: number, mesa: Mesa): Ponto {
  const larguraMax = mesa.largura - 2 * (CARD_W * 0.6);
  const passoIdeal = CARD_W + 12;
  const passo = total > 1 ? Math.min(passoIdeal, larguraMax / (total - 1)) : 0;
  const larguraTotal = passo * (total - 1);
  return {
    x: mesa.largura / 2 - larguraTotal / 2 + indice * passo,
    y: mesa.mao.topo + mesa.mao.altura / 2 - 4,
  };
}

/** Comandantes empilham lado a lado (parceiros / fundo). */
export function posicaoNoComando(indice: number, base: Ponto): Ponto {
  return { x: base.x + indice * 24, y: base.y - indice * 8 };
}

/** Zonas em que uma carta pode ser SOLTA dentro de uma faixa. */
export type ZonaDeSoltura = 'COMMAND' | 'LIBRARY' | 'GRAVEYARD' | 'EXILE' | 'BATTLEFIELD';

/**
 * Em que zona aterrissa uma carta solta em (x, y) — coordenadas absolutas.
 *
 * ─── POR QUE ISSO MORA AQUI ────────────────────────────────────────────────
 *
 * O GameBoard só sabia distinguir mão de campo. Soltar sobre o cemitério, o
 * exílio, o grimório ou a zona de comando caía no ramo do campo, e o clamp de
 * `posicaoNoCampo` devolvia a carta para dentro da área de batalha. Da cadeira
 * do jogador isso é indistinguível de "o arrasto não funciona" — funcionava,
 * só que o destino nunca era o que estava debaixo do cursor.
 *
 * A decisão vive junto da geometria de propósito: as âncoras e a regra de
 * acerto precisam mudar juntas. Separadas, mover uma pilha em `montarMesa`
 * deixaria a área de soltura para trás, em silêncio.
 *
 * A reserva não é destino: é zona oculta e de pré-jogo, e cair nela por um
 * arrasto impreciso esconderia a carta da mesa inteira.
 */
export function zonaSolta(faixa: Faixa, x: number, y: number): ZonaDeSoltura {
  if (x < faixa.campo.x) return 'COMMAND';
  if (x <= faixa.campo.x + faixa.campo.largura) return 'BATTLEFIELD';

  // Faixa das pilhas: vale a âncora mais próxima. Distância em vez de
  // retângulos porque o modo estreito reorganiza as mesmas quatro zonas numa
  // grade 2x2 — com retângulos, cada arranjo precisaria da sua própria conta.
  const alvos: Array<[ZonaDeSoltura, Ponto]> = [
    ['LIBRARY', faixa.grimorio],
    ['GRAVEYARD', faixa.cemiterio],
    ['EXILE', faixa.exilio],
  ];

  let zona: ZonaDeSoltura = 'GRAVEYARD';
  let menor = Number.POSITIVE_INFINITY;
  for (const [candidata, ancora] of alvos) {
    const distancia = Math.hypot(ancora.x - x, ancora.y - y);
    if (distancia < menor) {
      menor = distancia;
      zona = candidata;
    }
  }
  return zona;
}
