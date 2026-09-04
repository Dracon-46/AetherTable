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
 *   │ oponente 2   [pilhas] campo …    [cmd]   │  ← painel próprio
 *   └──────────────────────────────────────────┘
 *                    (respiro)
 *   ┌──────────────────────────────────────────┐
 *   │ oponente 1   [pilhas] campo …    [cmd]   │
 *   └──────────────────────────────────────────┘
 *                    (respiro)
 *   ┌──────────────────────────────────────────┐
 *   │ EU           [pilhas] campo …    [cmd]   │  ← em foco (maior)
 *   └──────────────────────────────────────────┘
 *   ┌──────────────────────────────────────────┐
 *   │ minha mão                                │
 *   └──────────────────────────────────────────┘
 *
 * As pilhas — grimório, cemitério, exílio e reserva — vivem no canto INFERIOR
 * ESQUERDO da faixa, e a zona de comando na direita. Era o contrário, e o lado
 * errado custava caro no gesto mais repetido do jogo: comprar. O grimório é a
 * pilha que se clica dezenas de vezes por partida, enquanto a zona de comando
 * é consultada uma vez a cada poucos turnos — a mais usada é que merece o canto
 * de origem da leitura.
 *
 * `ordem` decide QUANTAS faixas existem. Ver só a própria mesa é passar uma
 * lista de um elemento — não é um modo à parte, é a mesma função com menos
 * assentos.
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

/**
 * Respiro entre duas faixas.
 *
 * As faixas eram desenhadas encostadas: `topo` da seguinte era exatamente o
 * fim da anterior. Cada uma tinha borda arredondada, mas coladas elas liam
 * como UMA superfície listrada, e a pergunta "onde termina a mesa dele e
 * começa a minha" não tinha resposta visual. Numa mesa de quatro, uma carta
 * na borda de baixo da faixa do oponente parecia estar na borda de cima da
 * minha.
 *
 * O vazio entre elas é o que faz cada uma virar um painel próprio.
 */
export const ESPACO_ENTRE_FAIXAS = 18;

/**
 * Altura de uma faixa fora de foco: cabe uma fileira de cartas encolhidas.
 *
 * Era `CARD_H + 56` — altura de carta em tamanho CHEIO — enquanto as cartas ali
 * são desenhadas a 62%. Sobrava quase metade da faixa de espaço vazio, quatro
 * vezes na tela, empurrando a faixa em foco para caber no que restava.
 */
export const FAIXA_H = Math.round(CARD_H * 0.62) + 52;

/**
 * A faixa em foco: onde o jogo realmente acontece.
 *
 * Passou de três para QUATRO fileiras. Três fileiras dão ~500px lógicos para o
 * campo de batalha — e um deck de Commander de meio de partida tem terrenos,
 * criaturas e artefatos que passam de doze permanentes. Com três fileiras, a
 * quarta linha de cartas era empurrada pelo clamp de `posicaoNoCampo` para
 * cima das anteriores, e a mesa virava uma pilha.
 *
 * O custo é a faixa dos oponentes ficar menor — que é exatamente a troca certa:
 * a mesa deles é consulta, a minha é trabalho.
 */
export const FAIXA_FOCO_H = CARD_H * 4 + 96;

/** Quanto uma faixa fora de foco encolhe. */
export const ESCALA_FORA_DE_FOCO = 0.62;
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

/** Reservado à direita de cada faixa para a zona de comando. */
export const LARGURA_COMANDO = CARD_W + 48;
/**
 * Reservado à esquerda para as pilhas.
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
  /**
   * Canto superior esquerdo da célula, em coordenadas da mesa.
   *
   * Existe por causa da GRADE. Enquanto a mesa era só faixas empilhadas, toda
   * faixa começava em x=0 e ocupava a largura inteira, então a origem
   * horizontal era implícita — e o desenho no canvas usava `mesa.largura`
   * direto. Com células lado a lado isso deixa de valer.
   */
  esquerda: number;
  largura: number;
  topo: number;
  altura: number;
  emFoco: boolean;
  /**
   * Escala das cartas DESTA célula.
   *
   * Era derivada de `emFoco` pelo desenho (`escalaDaFaixa`), o que só faz
   * sentido no empilhado, onde a faixa em foco é maior. Na grade as células são
   * iguais por definição — o foco vira só cor de borda — e a escala precisa vir
   * de quem monta a geometria, não de quem desenha.
   */
  escala: number;
  /**
   * Escala das CARTAS DE ZONA desta faixa (comando e pilhas).
   *
   * Normalmente igual a `escala`. Ela existe separada porque o bloco de zonas
   * tem uma restrição que o campo não tem: três fileiras de carta MAIS o
   * rótulo de cada pilha precisam caber na altura disponível. Numa janela
   * baixa (500px) isso não cabe na escala do campo, e as opções eram encolher
   * a mesa inteira — voltando a ter carta ilegível na mão, que é o defeito que
   * esta geometria existe para corrigir — ou reordenar o bloco, que o jogador
   * pediu explicitamente para nunca acontecer.
   *
   * Encolher só o bloco preserva as duas coisas: a mão continua legível e a
   * ordem comando/pilhas continua a mesma em qualquer tela.
   */
  escalaZonas: number;
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
  /**
   * Faixa das zonas fixas (comando e pilhas), em y ABSOLUTO.
   *
   * `zonaSolta` usa isto para separar "soltou no campo" de "soltou numa zona"
   * sem precisar conhecer o arranjo — que é diferente no empilhado (comando à
   * esquerda, pilhas à direita) e na grade (tudo numa fileira embaixo).
   */
  zonas: { topo: number; altura: number };
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
    // O respiro vem ANTES de cada faixa menos a primeira: assim não sobra uma
    // folga órfã entre a última faixa e a mão.
    if (faixas.length > 0) y += ESPACO_ENTRE_FAIXAS;

    const emFoco = playerId === focoId;
    // Em tela estreita só existe a faixa em foco, e ela ganha altura extra
    // porque as pilhas passam a ocupar duas fileiras.
    const altura = estreito ? FAIXA_FOCO_H + CARD_H : emFoco ? FAIXA_FOCO_H : FAIXA_H;

    // Pilhas à ESQUERDA, comando à direita: o campo começa depois das pilhas e
    // termina antes do comando.
    const campoX = larguraPilhas;
    const campoLargura = largura - larguraPilhas - larguraComando;
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

    // Encostadas na borda esquerda da faixa, com a mesma folga que a antiga
    // fileira da direita tinha da borda oposta.
    const pilhaX = 24;
    const col = (i: number) => pilhaX + CARD_W / 2 + i * (CARD_W + 14);
    /** Grade 2x2 do modo estreito: a fileira 1 é a que encosta na base. */
    const linha = (i: number) => base - (1 - i) * (alturaCarta + 22);

    faixas.push({
      playerId,
      esquerda: 0,
      largura,
      topo: y,
      altura,
      emFoco,
      escala: escalaDaFaixa(emFoco),
      escalaZonas: escalaDaFaixa(emFoco),
      campo: { x: campoX, y: campoY, largura: campoLargura, altura: campoAltura },
      comando: { x: largura - larguraComando / 2 - 8, y: base },
      grimorio: estreito ? { x: col(0), y: linha(0) } : { x: col(0), y: base },
      cemiterio: estreito ? { x: col(1), y: linha(0) } : { x: col(1), y: base },
      exilio: estreito ? { x: col(0), y: linha(1) } : { x: col(2), y: base },
      reserva: estreito ? { x: col(1), y: linha(1) } : { x: col(3), y: base },
      rotulo: { x: 12, y: y + 6 },
      zonas: { topo: base - alturaCarta / 2 - 6, altura: alturaCarta + 12 },
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

/** Respiro entre as células da grade e entre elas e a borda da mesa. */
export const ESPACO_DA_GRADE = 16;

/**
 * Quantas colunas para N jogadores.
 *
 * Cresce pela raiz para manter a grade quadrada: 2→2x1, 3 e 4→2x2, 5 e 6→3x2,
 * 7 a 9→3x3. É o arranjo de uma mesa vista de cima, que é o que a visão "todos"
 * está tentando ser.
 */
export function colunasDaGrade(jogadores: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, jogadores))));
}

/**
 * montarGrade — a visão "todos", em QUADRADOS.
 *
 * ─── POR QUE ISTO NÃO É `montarMesa` COM OUTRO PARÂMETRO ───────────────────
 *
 * As duas respondem a perguntas diferentes, e por isso arranjam as zonas de
 * formas diferentes.
 *
 * O EMPILHADO é para JOGAR: a sua faixa é larga e baixa, com as pilhas à
 * esquerda e o comando à direita, porque a mão está logo abaixo e o gesto que
 * importa é mão → campo. Numa faixa de 1920x584 as zonas cabem nas pontas sem
 * roubar espaço do campo.
 *
 * A GRADE é para OLHAR: quatro mesas ao mesmo tempo. Numa célula quadrada as
 * zonas nas pontas comeriam a largura toda (comando + 4 pilhas ≈ 700px de 933),
 * e o campo viraria uma tira. Aqui elas vão para uma FILEIRA no rodapé da
 * célula, que é como uma mesa de verdade se organiza vista de cima: o campo no
 * meio, as pilhas na borda de baixo, na frente do jogador.
 *
 * Tentar servir as duas com um só arranjo é o que produziria o pior dos dois.
 */
export function montarGrade(ordem: string[], focoId: string): Mesa {
  const jogadores = Math.max(1, ordem.length);
  const colunas = colunasDaGrade(jogadores);
  const linhas = Math.ceil(jogadores / colunas);

  const largura = LOGICAL_W;
  // Célula QUADRADA: é o pedido, e é o que faz a grade ler como uma mesa em vez
  // de uma pilha de tiras.
  const lado = Math.floor((largura - ESPACO_DA_GRADE * (colunas + 1)) / colunas);

  /** A fileira de zonas no rodapé da célula. */
  const alturaZonas = CARD_H + 26;
  const alturaRotulo = 26;

  const faixas: Faixa[] = ordem.map((playerId, indice) => {
    const coluna = indice % colunas;
    const linha = Math.floor(indice / colunas);
    const esquerda = ESPACO_DA_GRADE + coluna * (lado + ESPACO_DA_GRADE);
    const topo = ESPACO_DA_GRADE + linha * (lado + ESPACO_DA_GRADE);

    const campo = {
      x: 10,
      y: alturaRotulo,
      largura: lado - 20,
      altura: lado - alturaRotulo - alturaZonas,
    };

    // Cinco âncoras igualmente espaçadas no rodapé: comando, grimório,
    // cemitério, exílio, reserva. A reserva ganha lugar mesmo quando vazia para
    // que as outras quatro não dancem quando ela aparece.
    const baseY = topo + lado - alturaZonas / 2 - 2;
    const passo = (lado - 20) / 5;
    const col = (i: number) => esquerda + 10 + passo * (i + 0.5);

    return {
      playerId,
      esquerda,
      largura: lado,
      topo,
      altura: lado,
      emFoco: playerId === focoId,
      // Células iguais, escala igual. O foco aqui é cor de borda, não tamanho.
      escala: 1,
      // A célula da grade não distingue: as zonas usam a escala da célula.
      escalaZonas: 1,
      campo,
      comando: { x: col(0), y: baseY },
      grimorio: { x: col(1), y: baseY },
      cemiterio: { x: col(2), y: baseY },
      exilio: { x: col(3), y: baseY },
      reserva: { x: col(4), y: baseY },
      rotulo: { x: esquerda + 10, y: topo + 6 },
      zonas: { topo: topo + lado - alturaZonas, altura: alturaZonas },
    };
  });

  const alturaGrade = ESPACO_DA_GRADE + linhas * (lado + ESPACO_DA_GRADE);

  return {
    largura,
    altura: alturaGrade + HAND_H,
    faixas,
    porJogador: new Map(faixas.map((f) => [f.playerId, f])),
    mao: { topo: alturaGrade, altura: HAND_H },
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
  // `esquerda` é a origem da célula: 0 no empilhado, o canto da célula na grade.
  const campoX = faixa.esquerda + campo.x;
  const campoY = faixa.topo + campo.y;

  /**
   * ─── O CLAMP PRECISA DA ESCALA DA FAIXA ────────────────────────────────
   *
   * Era `CARD_W / 2`, sem escala. A carta é DESENHADA com
   * `CARD_W * faixa.escala`, então o clamp usava a meia-largura errada em toda
   * faixa cuja escala não fosse exatamente 1:
   *
   *   escala < 1 (faixa fora de foco, célula de grade, trilho): o clamp era
   *     generoso demais e parava a carta antes da borda — sobrava uma margem
   *     morta de até 22px que o jogador não conseguia usar;
   *   escala > 1 (a mesa focada em monitor alto): o clamp era APERTADO demais
   *     e a carta transbordava a borda do campo.
   *
   * O segundo caso só apareceu quando a mesa focada passou a poder crescer
   * acima de 1 — um teste o pegou com 2,79px de transbordo. O primeiro estava
   * lá desde sempre, silencioso.
   */
  const meiaLargura = (CARD_W * faixa.escala) / 2;
  const meiaAltura = (CARD_H * faixa.escala) / 2;
  const minX = campoX + meiaLargura;
  const maxX = campoX + campo.largura - meiaLargura;
  const minY = campoY + meiaAltura;
  const maxY = campoY + campo.altura - meiaAltura;

  // Uma carta jogada por INTENT_CHANGE_ZONE sem coordenada chega em (0,0):
  // centraliza em vez de empilhar tudo no canto superior esquerdo.
  const bruta =
    x === 0 && y === 0
      ? { x: campoX + campo.largura / 2, y: campoY + campo.altura / 2 }
      : { x: campoX + x, y: campoY + y };

  return {
    x: Math.min(maxX, Math.max(minX, bruta.x)),
    y: Math.min(maxY, Math.max(minY, bruta.y)),
  };
}

/** Inverso de `posicaoNoCampo`: da tela lógica para o que vai ao servidor. */
export function paraCoordenadaRelativa(faixa: Faixa, x: number, y: number): Ponto {
  const { campo } = faixa;
  return {
    x: Math.round(Math.min(campo.largura, Math.max(0, x - faixa.esquerda - campo.x))),
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
/**
 * Folga em volta do slot. Pequena de propósito: é o "quase acertei" do arrasto,
 * não uma área de captura. Menor que metade do vão entre dois slots
 * (`CARD_W + 14`), então dois destinos nunca disputam o mesmo pixel.
 */
const TOLERANCIA_DE_SOLTURA = 6;

export function zonaSolta(faixa: Faixa, x: number, y: number): ZonaDeSoltura {
  /**
   * SÓ PEGA QUEM SOLTOU EM CIMA DA ZONA.
   *
   * ─── O QUE ESTAVA ERRADO ───────────────────────────────────────────────
   *
   * A regra anterior era "dentro do retângulo do campo é campo; FORA dele,
   * vale a âncora mais próxima". O `fora` não tinha limite: a margem da faixa,
   * o vão entre o campo e as pilhas, a tira acima do rótulo — tudo caía no
   * `else` e era atribuído a alguma zona, por mais longe que ela estivesse.
   *
   * Na prática o exílio (e qualquer slot de ponta) virava um ímã: soltar uma
   * carta perto da borda da faixa a mandava para lá, sem que nada na tela
   * tivesse indicado o destino. Da cadeira do jogador isso é a mesa comendo a
   * carta — o pior tipo de defeito, porque some com a peça e ainda parece
   * intencional.
   *
   * Agora cada zona tem a área do PRÓPRIO slot, mais uma folga de alguns
   * pixels. Não acertou nenhuma? É campo de batalha, e `posicaoNoCampo` traz a
   * carta de volta para dentro. O destino padrão passa a ser o inofensivo.
   */
  /**
   * `escalaZonas`, e não `escala`.
   *
   * A área de acerto tem de ser a da carta DESENHADA no slot, e as cartas de
   * zona podem ter escala própria (ver `Faixa.escalaZonas`). Usar a escala do
   * campo faria a área de soltura ser maior que o slot visível numa janela
   * baixa — o jogador soltaria a carta ao lado do cemitério e ela iria para o
   * cemitério, sem nada na tela ter indicado isso.
   */
  const meiaLargura = (CARD_W * faixa.escalaZonas) / 2 + TOLERANCIA_DE_SOLTURA;
  const meiaAltura = (CARD_H * faixa.escalaZonas) / 2 + TOLERANCIA_DE_SOLTURA;

  // A reserva NÃO entra: é zona oculta e de pré-jogo, e cair nela por um
  // arrasto impreciso esconderia a carta da mesa inteira. Soltar sobre ela é
  // soltar no campo.
  const alvos: Array<[ZonaDeSoltura, Ponto]> = [
    ['COMMAND', faixa.comando],
    ['LIBRARY', faixa.grimorio],
    ['GRAVEYARD', faixa.cemiterio],
    ['EXILE', faixa.exilio],
  ];

  for (const [zona, ancora] of alvos) {
    if (Math.abs(x - ancora.x) <= meiaLargura && Math.abs(y - ancora.y) <= meiaAltura) {
      return zona;
    }
  }

  return 'BATTLEFIELD';
}

// ─────────────────────────────────────────────────────────────────────────────
//  MESA FOCADA — a mesa fixa que ocupa a tela inteira
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ─── POR QUE ESTA GEOMETRIA EXISTE ─────────────────────────────────────────
 *
 * `montarMesa` e `montarGrade` montam um plano LÓGICO de largura fixa (1920) e
 * deixam o desenho encolher tudo até caber na área útil. Isso tem uma
 * consequência que ninguém tinha medido, e que o jogador relatou como "as
 * cartas estão muito pequenas e não dá para ler". Num monitor de 1600x950, com
 * as margens do HUD, a área útil é 1180x850 — e a escala sai assim:
 *
 *     minha mesa (1 faixa)   mesa 1920x968    escala 0.61  ->  carta de  74px
 *     grade de 4 jogadores   mesa 1920x2120   escala 0.40  ->  carta de  48px
 *
 * Contra 120px, que é a largura em que a arte de uma carta é legível. Não era
 * questão de ajustar uma constante: a conta partia de um plano que não cabe na
 * tela e depois reduzia o mundo inteiro para caber.
 *
 * Aqui a conta é invertida. A geometria é montada em PIXELS REAIS da área
 * disponível, ancorada no tamanho da carta: a carta tem o tamanho que precisa
 * ter, e o campo de batalha fica com o espaço que sobra. O desenho passa a usar
 * escala 1 — não existe mais reduzir a mesa para "caber".
 *
 * ─── E POR QUE NÃO TEM ZOOM ────────────────────────────────────────────────
 *
 * Com a mesa fixa, o zoom só serviria para uma coisa: afastar a câmera e voltar
 * a ter cartas ilegíveis. O jogador pediu explicitamente que a mesa dele ocupe
 * a tela inteira e que não dê para se afastar. Uma mesa que sempre cabe não
 * precisa de zoom nem de arraste de câmera — os dois existiam para compensar
 * uma mesa que não cabia.
 *
 * ─── A COLUNA DA DIREITA NUNCA MUDA ────────────────────────────────────────
 *
 * Comando no topo, e abaixo dele grimório, cemitério e exílio, sempre nessa
 * ordem, sempre no mesmo lugar. Zona não é conteúdo: é móvel da mesa. O jogador
 * compra dezenas de vezes por partida e a mão dele precisa saber onde o
 * grimório está sem olhar. Qualquer arranjo que reordene as pilhas por
 * conveniência de espaço troca memória muscular por pixels.
 */

/**
 * Altura de área útil em que a carta tem exatamente `CARD_W` de largura.
 *
 * Acima disto a carta cresce (monitor grande merece carta grande); abaixo, ela
 * encolhe — mas com piso, porque abaixo de um certo tamanho a mesa deixa de ser
 * jogável e o caminho certo passa a ser o layout de tela estreita.
 */
export const ALTURA_DE_REFERENCIA = 860;
export const ESCALA_MIN = 0.72;
export const ESCALA_MAX = 1.6;

/** Folga entre a coluna de zonas e a borda direita. */
const FOLGA_COLUNA = 18;
/** Espaço acima do campo, para o rótulo do jogador. */
const ALTURA_ROTULO = 26;

/**
 * Largura do trilho de oponentes, em múltiplos da largura da carta.
 *
 * O trilho FLUTUA sobre o campo: abrir e fechar não muda a geometria da mesa,
 * então a carta do jogador nunca muda de tamanho por causa dele. Foi a escolha
 * explícita do jogador entre as duas alternativas — a outra era o trilho
 * empurrar o campo, que redimensiona a mão a cada clique.
 */
const TRILHO_EM_CARTAS = 2.6;

/**
 * Folga entre o trilho e a coluna de zonas.
 *
 * Sem ela os dois ficam encostados, e num retrato da mesa os rótulos das zonas
 * do oponente ("CEMITÉRIO", "EXÍLIO") colidem com os meus — duas colunas de
 * pilhas coladas, sem nada dizendo onde uma acaba.
 */
const FOLGA_TRILHO = 14;

/**
 * Teto de altura de uma célula do trilho, em alturas de carta.
 *
 * Sem teto, UM oponente recebia a coluna inteira: uma tira altíssima e estreita
 * com quatro pilhas perdidas no meio de um vazio vertical. A mesa de alguém em
 * miniatura precisa PARECER uma mesa, e para isso a célula tem de manter
 * proporção — o que sobra fica sobrando, não é esticado.
 */
const ALTURA_MAX_DA_CELULA = 2.9;

export interface OpcoesMesaFocada {
  /** Pixels disponíveis para a mesa (já descontado o HUD). */
  largura: number;
  altura: number;
  /** Assento desenhado grande, ocupando a tela. */
  focoId: string;
  /** Assentos do trilho da direita, de cima para baixo. */
  oponentes?: string[];
  /** `false` = o trilho está recolhido e nenhuma faixa de oponente é montada. */
  trilhoAberto?: boolean;
}

/**
 * ─── O ARRANJO DO BLOCO DE ZONAS, E ELE É A REGRA ──────────────────────────
 *
 *     ┌───────────────────────┐
 *     │       COMANDO         │   ← sozinho, acima e centralizado
 *     ├───────┬───────┬───────┤
 *     │GRIMÓR.│CEMITÉR│EXÍLIO │   ← LADO A LADO, na mesma linha
 *     ├───────┴───────┴───────┤
 *     │       RESERVA         │   ← abaixo, e só aparece com cartas
 *     └───────────────────────┘
 *
 * A primeira versão disto empilhou os QUATRO numa coluna vertical de uma carta
 * de largura. Estava errado por leitura minha: o pedido era "o comandante fica
 * acima deles" — só ele. Os três de pilha ficam lado a lado.
 *
 * E a coluna única era ruim por conta própria: quatro slots de altura de carta
 * não cabem numa tela de 900px junto com campo e mão, então o passo vertical
 * comprimia e as pilhas se sobrepunham — viravam um empilhamento ilegível em
 * vez de três zonas distinguíveis.
 *
 * O comandante fica em cima porque é a única carta do bloco que se OLHA: ele
 * responde "para onde ele volta" e "quanto vai custar". As três pilhas se
 * CLICAM, e lado a lado cada uma tem alvo próprio e previsível.
 */
const COLUNAS_DO_BLOCO = 3;
/** Vão entre as pilhas e entre as fileiras do bloco. */
const VAO_DO_BLOCO = 10;

/**
 * Espaço reservado ACIMA de cada pilha para o rótulo dela.
 *
 * `Pilha` desenha o nome da zona em `y = -16 * escala`, ou seja, FORA da carta,
 * logo acima. Sem reservar isso entre a fileira do comandante e a das pilhas,
 * a carta do comandante cobria exatamente a faixa dos rótulos — num retrato da
 * mesa o "CEMITÉRIO" do meio simplesmente não aparecia, enquanto "GRIMÓRIO" e
 * "EXÍLIO" (que sobram para os lados do comandante centralizado) apareciam.
 *
 * Uma zona sem nome numa mesa de Magic é uma pilha anônima de cartas viradas —
 * e era a do MEIO, a mais fácil de confundir com as duas vizinhas.
 */
const ROTULO_DA_PILHA = 22;

export function montarMesaFocada(opcoes: OpcoesMesaFocada): Mesa {
  const { focoId, oponentes = [], trilhoAberto = true } = opcoes;

  const largura = Math.max(480, Math.round(opcoes.largura));
  const altura = Math.max(420, Math.round(opcoes.altura));

  const escala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, altura / ALTURA_DE_REFERENCIA));
  /**
   * Só a ALTURA da carta entra na geometria da mesa focada.
   *
   * A largura não: as permanentes são posicionadas por `posicaoNoCampo`, que
   * usa `faixa.escala` por conta própria, e o bloco de zonas tem largura
   * própria (`zonaW`, derivada de `escalaZonas`). Um `cardW` aqui seria uma
   * variável que parece participar do arranjo e não participa.
   */
  const cardH = CARD_H * escala;

  const maoAltura = cardH + 32 * escala;
  const rotulo = ALTURA_ROTULO * escala;

  const campoAltura = altura - maoAltura - rotulo;

  /**
   * Escala do BLOCO DE ZONAS — a única coisa que encolhe numa janela baixa.
   *
   * Três fileiras de carta mais o rótulo de cada pilha precisam caber em
   * `campoAltura`. Quando não cabem na escala do campo, o bloco encolhe; a mão
   * e as permanentes não. Ver `Faixa.escalaZonas`.
   */
  const escalaZonas = Math.min(
    escala,
    campoAltura / (CARD_H * 3 + (VAO_DO_BLOCO + ROTULO_DA_PILHA) * 2),
  );
  const zonaW = CARD_W * escalaZonas;
  const zonaH = CARD_H * escalaZonas;
  const vao = VAO_DO_BLOCO * escalaZonas;

  /** Largura do bloco de zonas: três pilhas lado a lado, mais os vãos. */
  const blocoLargura =
    COLUNAS_DO_BLOCO * zonaW + (COLUNAS_DO_BLOCO - 1) * vao + FOLGA_COLUNA * escalaZonas * 2;

  // ── Campo de batalha: tudo menos o bloco da direita e a mão ──────────────
  const campoLargura = largura - blocoLargura;

  /**
   * Passo vertical entre as fileiras do bloco.
   *
   * Três fileiras (comando / pilhas / reserva) de altura de carta cabem em
   * qualquer tela onde a mesa é jogável. Quando não cabem, o vão encolhe — e
   * se ainda assim não couber, as fileiras se aproximam. O que NUNCA muda é a
   * ordem e o fato de as três pilhas ficarem na mesma linha.
   */
  /**
   * `(campoAltura - cardH) / 2`, e não `campoAltura / 3`.
   *
   * O centro da fileira `r` fica em `cardH/2 + r * passo`, então a BASE da
   * última fileira está em `cardH + 2 * passo` — não em `3 * passo`. Dividir
   * por três esquecia a meia-carta de cada ponta e a reserva estourava para
   * baixo da faixa de mão; um teste pegou 7,5px de transbordo na tela mais
   * baixa. É o mesmo tipo de erro do clamp de `posicaoNoCampo`: confundir o
   * passo entre CENTROS com o espaço que a fileira ocupa.
   */
  const passo = zonaH + vao + ROTULO_DA_PILHA * escalaZonas;
  const blocoX = campoLargura + FOLGA_COLUNA * escalaZonas;
  /** Centro horizontal da coluna `c` do bloco (0, 1, 2). */
  const colX = (c: number) => blocoX + zonaW / 2 + c * (zonaW + vao);
  /** Centro vertical da fileira `r` do bloco. */
  const rowY = (r: number) => rotulo + zonaH / 2 + r * passo;
  /** Centro horizontal do bloco inteiro — para o que é centralizado. */
  const centroDoBloco = colX(0) + ((COLUNAS_DO_BLOCO - 1) * (zonaW + vao)) / 2;

  const posicoes = {
    // Fileira 0: o comandante, sozinho e centralizado sobre as três pilhas.
    comando: { x: centroDoBloco, y: rowY(0) },
    // Fileira 1: as três pilhas, LADO A LADO. Grimório primeiro porque é a
    // mais clicada da partida e a leitura começa pela esquerda.
    grimorio: { x: colX(0), y: rowY(1) },
    cemiterio: { x: colX(1), y: rowY(1) },
    exilio: { x: colX(2), y: rowY(1) },
    // Fileira 2: a reserva. Fica fora da fileira das três porque não é zona de
    // partida — é pré-jogo e wishboard — e só é desenhada quando tem cartas.
    reserva: { x: centroDoBloco, y: rowY(2) },
  } satisfies Record<string, Ponto>;

  const faixaDoFoco: Faixa = {
    playerId: focoId,
    esquerda: 0,
    largura,
    topo: 0,
    altura: altura - maoAltura,
    emFoco: true,
    escala,
    escalaZonas,
    campo: { x: 0, y: rotulo, largura: campoLargura, altura: campoAltura },
    comando: posicoes.comando,
    grimorio: posicoes.grimorio,
    cemiterio: posicoes.cemiterio,
    exilio: posicoes.exilio,
    reserva: posicoes.reserva,
    rotulo: { x: 12, y: 4 },
    /**
     * A tira cobre as TRÊS fileiras do bloco.
     *
     * `zonaSolta` não usa este campo para acertar o alvo (ele testa slot por
     * slot), mas o desenho usa para a moldura — e uma tira com a altura de uma
     * fileira deixaria comando e reserva fora dela.
     */
    zonas: { topo: rotulo, altura: passo * 2 + zonaH },
  };

  const faixas: Faixa[] = [faixaDoFoco];

  // ── Trilho dos oponentes: FLUTUA sobre o campo, à esquerda da coluna ─────
  if (trilhoAberto && oponentes.length > 0) {
    const trilhoLargura = zonaW * TRILHO_EM_CARTAS;
    const trilhoX = campoLargura - trilhoLargura - FOLGA_TRILHO;
    const disponivel = altura - maoAltura - rotulo;
    const alturaPorOponente = Math.min(
      disponivel / oponentes.length,
      CARD_H * ALTURA_MAX_DA_CELULA,
    );
    // A escala do trilho vem da CÉLULA dele, não da mesa: é o que faz a mesa do
    // oponente caber "de forma pequena mesmo" sem deformar nada.
    // A miniatura precisa caber um campinho MAIS o bloco de três pilhas.
    const escalaTrilho = Math.min(
      trilhoLargura / (CARD_W * 4),
      alturaPorOponente / (CARD_H * 3 + (VAO_DO_BLOCO + ROTULO_DA_PILHA) * 2),
    );
    const cardWt = CARD_W * escalaTrilho;
    const cardHt = CARD_H * escalaTrilho;

    // Empilha a partir do topo do campo, não da borda da tela: a fileira de
    // botões do HUD vive ali e cobriria a primeira célula.
    oponentes.forEach((playerId, i) => {
      const topo = rotulo + i * alturaPorOponente;
      const rotuloT = 18 * escalaTrilho;
      // Mesmo arranjo da mesa grande, em miniatura: campo à esquerda, coluna de
      // zonas à direita. Um arranjo diferente no trilho obrigaria o jogador a
      // reaprender onde está o cemitério do vizinho.
      const vaoT = 5 * escalaTrilho;
      const blocoLarguraT = COLUNAS_DO_BLOCO * cardWt + (COLUNAS_DO_BLOCO - 1) * vaoT;
      const campoLarguraT = Math.max(cardWt * 0.6, trilhoLargura - blocoLarguraT - vaoT);
      const passoT = cardHt + vaoT + ROTULO_DA_PILHA * escalaTrilho;
      const blocoXt = trilhoX + campoLarguraT + vaoT;
      const colXt = (c: number) => blocoXt + cardWt / 2 + c * (cardWt + vaoT);
      const rowYt = (r: number) => topo + rotuloT + cardHt / 2 + r * passoT;
      const centroT = colXt(0) + ((COLUNAS_DO_BLOCO - 1) * (cardWt + vaoT)) / 2;

      faixas.push({
        playerId,
        esquerda: trilhoX,
        largura: trilhoLargura,
        topo,
        altura: alturaPorOponente,
        emFoco: false,
        escala: escalaTrilho,
        escalaZonas: escalaTrilho,
        campo: {
          x: 0,
          y: rotuloT,
          largura: campoLarguraT,
          altura: alturaPorOponente - rotuloT - 4,
        },
        comando: { x: centroT, y: rowYt(0) },
        grimorio: { x: colXt(0), y: rowYt(1) },
        cemiterio: { x: colXt(1), y: rowYt(1) },
        exilio: { x: colXt(2), y: rowYt(1) },
        reserva: { x: centroT, y: rowYt(2) },
        rotulo: { x: trilhoX + 6, y: topo + 2 },
        zonas: { topo: topo + rotuloT, altura: passoT * 2 + cardHt },
      });
    });
  }

  return {
    largura,
    altura,
    faixas,
    porJogador: new Map(faixas.map((f) => [f.playerId, f])),
    mao: { topo: altura - maoAltura, altura: maoAltura },
  };
}
