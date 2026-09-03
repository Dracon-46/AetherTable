/**
 * legalidade.ts — a validação de deck de Magic, num lugar só.
 *
 * ─── O QUE EXISTIA ANTES ───────────────────────────────────────────────────
 *
 * Duas verificações, e nada mais:
 *
 *   1. tamanho do deck (uma tabela de 8 formatos em `decks/formato.ts`);
 *   2. `isBanned`, que o backend calculava olhando UMA chave de `legalities`.
 *
 * Faltava tudo o que faz um deck ser legal em Magic:
 *
 *   - **limite de cópias.** Nada impedia 40 Lightning Bolt num deck de Modern.
 *     É a regra mais básica do jogo construído e não estava em lugar nenhum.
 *   - **singleton.** Commander exige uma cópia de cada carta. O deck com quatro
 *     Sol Ring passava na contagem de 100 e entrava na mesa.
 *   - **terreno básico é exceção** às duas regras acima — sem isso, "singleton"
 *     recusaria os 36 terrenos de qualquer deck de Commander.
 *   - **identidade de cor.** A regra que mais define a construção de um deck de
 *     Commander: nenhuma carta pode ter cor fora da identidade do comandante.
 *   - **tipo do comandante.** Só verificava a EXISTÊNCIA de uma carta marcada
 *     como comandante, não se ela é uma criatura lendária. Qualquer carta podia
 *     ser promovida — inclusive um terreno.
 *   - **restritas.** Vintage tem uma lista de máximo 1 cópia, distinta de
 *     banida. A Scryfall devolve `'restricted'` e o código só olhava `'banned'`.
 *   - **teto de raridade.** Pauper é "só comuns", e a raridade nunca era lida.
 *   - **reserva.** Máximo 15 no construído, e a reserva não era contada.
 *
 * ─── AVISO, NÃO IMPEDIMENTO (RN05 / RN01) ──────────────────────────────────
 *
 * O produto é um sandbox: DOC-037 §2 é explícito em que "a validação continua
 * não bloqueante em todos os formatos". Então cada achado tem uma GRAVIDADE:
 *
 *   'erro'  — impede entrar numa mesa DAQUELE formato.
 *   'aviso' — aparece no deckbuilder e não impede nada. É a maioria.
 *
 * ─── O QUE BLOQUEIA, E POR QUE SÓ ISSO ─────────────────────────────────────
 *
 * Quatro achados, cada um por um motivo diferente de "é a regra":
 *
 *   TAMANHO             — trava de JUSTIÇA DA MESA, não lembrete de construção.
 *                         Um deck de 40 cartas numa mesa de Commander muda a
 *                         partida para as outras três pessoas, que não
 *                         escolheram isso.
 *   SEM_COMANDANTE      — a mesa não consegue montar: a zona de comando nasce
 *                         vazia, com imposto e dano de comandante que nunca
 *                         teriam de onde sair. Antes o sintoma só aparecia
 *                         DEPOIS de todo mundo já ter entrado.
 *   COMANDANTES_DEMAIS  — acima de dois não existe regra de formato nenhum.
 *   BANIDA              — decisão de produto: a plataforma não hospeda partida
 *                         com carta banida no formato anunciado.
 *
 * Tudo o mais é aviso, inclusive singleton e limite de cópias — que são regras
 * de verdade do jogo, mas cujo desrespeito não impede a mesa de funcionar. Num
 * sandbox (RN01), a fronteira do bloqueio é o que a MESA precisa, não o que o
 * juiz diria.
 *
 * A separação é o que permite o jogador montar um deck em paz enquanto ainda
 * está montando, e ao mesmo tempo não descobrir na mesa que o deck nunca
 * poderia ter entrado.
 */

import { acharFormato, descreverTamanho, type FormatPreset } from './format';

/** As cinco cores, na ordem canônica. */
export const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

const NOME_DA_COR: Record<string, string> = {
  W: 'branco',
  U: 'azul',
  B: 'preto',
  R: 'vermelho',
  G: 'verde',
};

/** Ordem de raridade, para comparar com o teto do formato. */
const PESO_DA_RARIDADE: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  mythic: 3,
  special: 3,
  bonus: 3,
};

/**
 * O que a validação precisa saber sobre uma carta.
 *
 * Todo campo além de `quantity`/`boardType` é OPCIONAL porque ele vem da
 * hidratação na Scryfall, e a hidratação pode falhar (rede, provedor fora).
 * Uma regra que não pode ser avaliada por falta de dado não vira um achado —
 * vira silêncio. Inventar "ilegal" a partir de dado ausente transformaria uma
 * queda da Scryfall em "todos os decks ficaram inválidos".
 */
export interface CartaValidavel {
  scryfallId?: string;
  quantity?: number;
  boardType?: string;
  name?: string;
  typeLine?: string;
  rarity?: string;
  cmc?: number | null;
  colorIdentity?: string[];
  /** O objeto `legalities` da Scryfall, cru. */
  legalities?: Record<string, string>;
  /** Pré-computado pelo backend a partir de `legalities` + formato do deck. */
  isBanned?: boolean;
}

export interface DeckValidavel {
  formatId?: string | null;
  cardCount?: number;
  cards: CartaValidavel[];
}

export type Gravidade = 'erro' | 'aviso';

export interface Achado {
  /** Estável, para a interface poder agrupar e testar. */
  codigo:
    | 'TAMANHO'
    | 'COPIAS'
    | 'SINGLETON'
    | 'BANIDA'
    | 'RESTRITA'
    | 'FORA_DO_FORMATO'
    | 'RARIDADE'
    | 'VALOR_DE_MANA'
    | 'RESERVA'
    | 'SEM_COMANDANTE'
    | 'COMANDANTES_DEMAIS'
    | 'TIPO_DE_COMANDANTE'
    | 'RARIDADE_DO_COMANDANTE'
    | 'IDENTIDADE_DE_COR'
    | 'SEM_FEITICO_ASSINATURA'
    | 'LISTA_DE_PONTOS'
    | 'CONTADOR_DESSINCRONIZADO';
  gravidade: Gravidade;
  mensagem: string;
  /** Nomes das cartas envolvidas, quando o achado é sobre cartas. */
  cartas?: string[];
}

export interface Legalidade {
  formato: FormatPreset;
  /** Cartas contáveis (main + comando + feitiço-assinatura). */
  total: number;
  totalReserva: number;
  achados: Achado[];
  /** `true` quando nenhum achado é de gravidade 'erro'. */
  podeEntrarNaMesa: boolean;
  /** Identidade de cor deduzida do(s) comandante(s), em WUBRG. */
  identidadeDeCor: string[];
}

/** Só estes board types contam como "o deck". Reserva e maybeboard ficam fora. */
const NA_CONTAGEM = new Set(['MAIN', 'COMMANDER', 'SIGNATURE_SPELL']);

/**
 * Terreno básico escapa do limite de cópias E do singleton.
 *
 * Sem esta exceção, "singleton" recusaria os 36 terrenos de qualquer deck de
 * Commander e o limite de 4 recusaria os 24 de qualquer deck de Standard — quer
 * dizer, o validador reprovaria todo deck legal do jogo.
 *
 * A regra oficial é sobre o supertipo `Basic Land`, não sobre a lista de nomes:
 * Wastes e Snow-Covered Forest são básicos, e uma carta chamada "Forest" que não
 * seja terreno básico (existe) não é.
 */
function eBasico(carta: CartaValidavel): boolean {
  const t = carta.typeLine?.toLowerCase() ?? '';
  return t.includes('basic') && t.includes('land');
}

function eLendaria(carta: CartaValidavel): boolean {
  return (carta.typeLine?.toLowerCase() ?? '').includes('legendary');
}

function contemTipo(carta: CartaValidavel, tipo: string): boolean {
  return (carta.typeLine?.toLowerCase() ?? '').includes(tipo);
}

/** Junta nomes para a mensagem, com um teto para não virar um parágrafo. */
function listar(nomes: string[], teto = 6): string {
  const unicos = [...new Set(nomes)];
  if (unicos.length <= teto) return unicos.join(', ');
  return `${unicos.slice(0, teto).join(', ')} e ${unicos.length - teto} outra(s)`;
}

function nomeDe(carta: CartaValidavel): string {
  return carta.name ?? 'carta desconhecida';
}

/** Soma as cartas contáveis. `quantity` ausente vale 1 (`@default(1)`). */
export function contarCartas(cards: CartaValidavel[]): number {
  return cards.reduce(
    (soma, c) => (NA_CONTAGEM.has(c.boardType ?? 'MAIN') ? soma + (c.quantity ?? 1) : soma),
    0,
  );
}

/**
 * Avalia o deck contra o preset do formato.
 *
 * `formatoDaSala` vence `deck.formatId` quando informado: a sala é que define o
 * que está sendo jogado. Sem isso, levar um deck marcado como "commander" para
 * uma sala de Modern passaria pela regra errada.
 */
export function avaliarLegalidade(deck: DeckValidavel, formatoDaSala?: string): Legalidade {
  const formato = acharFormato(formatoDaSala || deck.formatId);
  const regras = formato.deck;
  const achados: Achado[] = [];

  const contaveis = deck.cards.filter((c) => NA_CONTAGEM.has(c.boardType ?? 'MAIN'));
  const naReserva = deck.cards.filter((c) => (c.boardType ?? 'MAIN') === 'SIDEBOARD');
  const comandantes = deck.cards.filter((c) => c.boardType === 'COMMANDER');
  const feiticos = deck.cards.filter((c) => c.boardType === 'SIGNATURE_SPELL');

  const total = contarCartas(deck.cards);
  const totalReserva = naReserva.reduce((s, c) => s + (c.quantity ?? 1), 0);

  // ── Contador desnormalizado ──────────────────────────────────────────────
  //
  // `deck.cardCount` é mantido por increment/decrement em statements separados
  // da escrita da carta. Uma falha entre os dois deixa o contador errado, e
  // validar CONTRA ele significaria recusar uma mesa por causa de um número que
  // não corresponde a nada. A verdade é a soma; a divergência é um aviso.
  if (deck.cardCount !== undefined && deck.cardCount !== total) {
    achados.push({
      codigo: 'CONTADOR_DESSINCRONIZADO',
      gravidade: 'aviso',
      mensagem: `O contador do grimório diz ${deck.cardCount} cartas, mas a lista tem ${total}. Uma escrita falhou pela metade; abrir e fechar o deck corrige.`,
    });
  }

  // ── Tamanho ──────────────────────────────────────────────────────────────
  //
  // A ORDEM IMPORTA: o tamanho é o PRIMEIRO achado empilhado, e
  // `motivoDeBloqueio` reporta o primeiro erro. Um deck de 40 cartas sem
  // comandante erra nas duas coisas, e a mensagem útil é a do tamanho — é o
  // problema maior e o que o jogador resolve primeiro.
  if (regras.exato !== null && total !== regras.exato) {
    achados.push({
      codigo: 'TAMANHO',
      gravidade: 'erro',
      mensagem: `O grimório possui ${total} cartas, mas ${formato.nome} exige ${descreverTamanho(regras)}.`,
    });
  } else if (regras.exato === null) {
    if (regras.minimo !== null && total < regras.minimo) {
      achados.push({
        codigo: 'TAMANHO',
        gravidade: 'erro',
        mensagem: `O grimório possui ${total} cartas, mas ${formato.nome} exige ${descreverTamanho(regras)}.`,
      });
    }
    if (regras.maximo !== null && total > regras.maximo) {
      achados.push({
        codigo: 'TAMANHO',
        gravidade: 'erro',
        mensagem: `O grimório possui ${total} cartas, mas ${formato.nome} permite ${descreverTamanho(regras)}.`,
      });
    }
  }

  // ── Cópias e singleton ───────────────────────────────────────────────────
  //
  // Agrupa por NOME, não por `scryfallId`: quatro impressões diferentes de Sol
  // Ring são quatro cópias da mesma carta pelas regras do jogo. Agrupar por id
  // deixaria passar exatamente a forma mais comum de furar o singleton num
  // deckbuilder — trocar a arte.
  const porNome = new Map<string, { qtd: number; carta: CartaValidavel }>();
  for (const c of contaveis) {
    if (eBasico(c)) continue;
    const chave = (c.name ?? c.scryfallId ?? '?').split(' // ')[0]!.toLowerCase();
    const atual = porNome.get(chave);
    if (atual) atual.qtd += c.quantity ?? 1;
    else porNome.set(chave, { qtd: c.quantity ?? 1, carta: c });
  }

  if (regras.singleton) {
    const repetidas = [...porNome.values()].filter((e) => e.qtd > 1);
    if (repetidas.length > 0) {
      achados.push({
        codigo: 'SINGLETON',
        gravidade: 'aviso',
        mensagem: `${formato.nome} é singleton: uma cópia de cada carta (terrenos básicos à parte). Repetidas: ${listar(repetidas.map((e) => nomeDe(e.carta)))}.`,
        cartas: repetidas.map((e) => nomeDe(e.carta)),
      });
    }
  } else {
    const excedentes = [...porNome.values()].filter((e) => e.qtd > regras.maxCopias);
    if (excedentes.length > 0) {
      achados.push({
        codigo: 'COPIAS',
        gravidade: 'aviso',
        mensagem: `${formato.nome} permite até ${regras.maxCopias} cópias de cada carta. Acima do limite: ${listar(excedentes.map((e) => `${nomeDe(e.carta)} (${e.qtd})`))}.`,
        cartas: excedentes.map((e) => nomeDe(e.carta)),
      });
    }
  }

  // ── Banidas e restritas ──────────────────────────────────────────────────
  //
  // Duas fontes, de propósito: `legalities` cru quando a hidratação trouxe (o
  // caminho completo, que distingue banned de restricted e de not_legal), e o
  // `isBanned` pré-computado como recuo, porque a API de deck já devolve esse
  // campo e o cliente pode não ter o objeto inteiro.
  const chave = regras.chaveDeLegalidade;
  const banidas: string[] = [];
  const restritas: { nome: string; qtd: number }[] = [];
  const foraDoFormato: string[] = [];

  for (const c of contaveis) {
    const situacao = chave ? c.legalities?.[chave] : undefined;
    if (situacao === undefined) {
      // Sem `legalities`: usa o recuo, e só ele.
      if (c.isBanned) banidas.push(nomeDe(c));
      continue;
    }
    if (situacao === 'banned') banidas.push(nomeDe(c));
    else if (situacao === 'restricted') {
      if ((c.quantity ?? 1) > 1) restritas.push({ nome: nomeDe(c), qtd: c.quantity ?? 1 });
    } else if (situacao === 'not_legal') foraDoFormato.push(nomeDe(c));
  }

  if (banidas.length > 0) {
    achados.push({
      codigo: 'BANIDA',
      // ERRO, e é um dos dois únicos casos de bloqueio junto com o comandante
      // ausente: a plataforma não hospeda partida com carta banida no formato
      // anunciado, e essa é uma decisão de produto, não de regra de jogo.
      gravidade: 'erro',
      mensagem: `Cartas banidas em ${formato.nome}: ${listar(banidas)}.`,
      cartas: banidas,
    });
  }
  if (restritas.length > 0) {
    achados.push({
      codigo: 'RESTRITA',
      gravidade: 'aviso',
      mensagem: `${formato.nome} restringe estas cartas a UMA cópia: ${listar(restritas.map((r) => `${r.nome} (${r.qtd})`))}.`,
      cartas: restritas.map((r) => r.nome),
    });
  }
  if (foraDoFormato.length > 0) {
    achados.push({
      codigo: 'FORA_DO_FORMATO',
      gravidade: 'aviso',
      mensagem: `Cartas que não existem no pool de ${formato.nome}: ${listar(foraDoFormato)}.`,
      cartas: foraDoFormato,
    });
  }

  // ── Teto de raridade (Pauper, Peasant, PDH) ──────────────────────────────
  if (regras.tetoDeRaridade) {
    const teto = PESO_DA_RARIDADE[regras.tetoDeRaridade] ?? 0;
    const acima = contaveis.filter((c) => {
      // O comandante tem teto PRÓPRIO em PDH (incomum num deck de comuns), e
      // aplicar o teto do deck nele acusaria todo comandante legal de PDH.
      if (c.boardType === 'COMMANDER') return false;
      const r = c.rarity ? PESO_DA_RARIDADE[c.rarity] : undefined;
      return r !== undefined && r > teto;
    });
    if (acima.length > 0) {
      achados.push({
        codigo: 'RARIDADE',
        gravidade: 'aviso',
        mensagem: `${formato.nome} aceita no máximo ${regras.tetoDeRaridade === 'common' ? 'comuns' : 'incomuns'}. Acima do teto: ${listar(acima.map(nomeDe))}.`,
        cartas: acima.map(nomeDe),
      });
    }
  }

  // ── Valor de mana (Tiny Leaders) ─────────────────────────────────────────
  if (regras.maxValorDeMana !== null) {
    const caras = contaveis.filter(
      (c) => typeof c.cmc === 'number' && c.cmc > regras.maxValorDeMana!,
    );
    if (caras.length > 0) {
      achados.push({
        codigo: 'VALOR_DE_MANA',
        gravidade: 'aviso',
        mensagem: `${formato.nome} não aceita custo acima de ${regras.maxValorDeMana}. Acima: ${listar(caras.map(nomeDe))}.`,
        cartas: caras.map(nomeDe),
      });
    }
  }

  // ── Reserva ──────────────────────────────────────────────────────────────
  if (regras.reserva === null && totalReserva > 0) {
    achados.push({
      codigo: 'RESERVA',
      gravidade: 'aviso',
      mensagem: `${formato.nome} não tem reserva; as ${totalReserva} cartas na reserva não entram na partida.`,
    });
  } else if (regras.reserva && totalReserva > regras.reserva.max) {
    achados.push({
      codigo: 'RESERVA',
      gravidade: 'aviso',
      mensagem: `A reserva tem ${totalReserva} cartas; ${formato.nome} permite até ${regras.reserva.max}.`,
    });
  }

  if (regras.listaDePontos) {
    achados.push({
      codigo: 'LISTA_DE_PONTOS',
      gravidade: 'aviso',
      mensagem: `${formato.nome} usa lista de pontos, e o sistema não a calcula: confira o total com o grupo antes de jogar.`,
    });
  }

  // ── Comandante ───────────────────────────────────────────────────────────
  let identidadeDeCor: string[] = [];

  if (formato.comandante) {
    const rc = formato.comandante;

    if (comandantes.length < rc.quantidade.minimo) {
      achados.push({
        codigo: 'SEM_COMANDANTE',
        gravidade: 'erro',
        mensagem: `${formato.nome} exige ${rc.tipo === 'planeswalker' ? 'um planeswalker' : 'um comandante'}. Abra o deck e marque a carta antes de entrar na mesa.`,
      });
    }

    if (comandantes.length > rc.quantidade.maximo) {
      achados.push({
        codigo: 'COMANDANTES_DEMAIS',
        gravidade: 'erro',
        mensagem:
          rc.quantidade.maximo === 2
            ? `O deck tem ${comandantes.length} comandantes; o máximo é 2 (parceiros).`
            : `O deck tem ${comandantes.length} comandantes; ${formato.nome} permite ${rc.quantidade.maximo}.`,
        cartas: comandantes.map(nomeDe),
      });
    }

    // DOIS comandantes só é legal com Partner / Background / Friends forever, e
    // essas habilidades existem apenas no TEXTO da carta — a Scryfall não tem
    // campo estruturado para elas. O sistema não pode verificar, então avisa.
    if (comandantes.length === 2 && rc.quantidade.maximo >= 2) {
      achados.push({
        codigo: 'TIPO_DE_COMANDANTE',
        gravidade: 'aviso',
        mensagem: `Dois comandantes só valem com Partner, Background ou Friends forever — o sistema não consegue conferir isso. Verifique: ${listar(comandantes.map(nomeDe))}.`,
        cartas: comandantes.map(nomeDe),
      });
    }

    // Tipo do comandante. Só avalia quando a linha de tipo chegou: sem ela,
    // acusar "não é lendária" seria acusar a Scryfall de estar fora do ar.
    const comTipo = comandantes.filter((c) => c.typeLine);
    const tipoErrado = comTipo.filter((c) => {
      if (rc.tipo === 'planeswalker') return !contemTipo(c, 'planeswalker');
      // Uma criatura lendária é o caso normal. "Pode ser seu comandante" é
      // texto de regra que a Scryfall NÃO devolve em campo estruturado (existe
      // só no oracle text), então cartas como Grist ou os Backgrounds caem no
      // aviso — que é o comportamento certo num sandbox: avisa, não impede.
      return !(eLendaria(c) && contemTipo(c, 'creature'));
    });
    if (tipoErrado.length > 0) {
      achados.push({
        codigo: 'TIPO_DE_COMANDANTE',
        gravidade: 'aviso',
        mensagem:
          rc.tipo === 'planeswalker'
            ? `Em ${formato.nome} o comandante é um planeswalker. Verifique: ${listar(tipoErrado.map(nomeDe))}.`
            : `O comandante costuma ser uma criatura lendária. Verifique se a carta diz "pode ser seu comandante": ${listar(tipoErrado.map(nomeDe))}.`,
        cartas: tipoErrado.map(nomeDe),
      });
    }

    if (rc.raridadeDoComandante) {
      const teto = PESO_DA_RARIDADE[rc.raridadeDoComandante] ?? 0;
      const fora = comandantes.filter((c) => {
        const r = c.rarity ? PESO_DA_RARIDADE[c.rarity] : undefined;
        return r !== undefined && r > teto;
      });
      if (fora.length > 0) {
        achados.push({
          codigo: 'RARIDADE_DO_COMANDANTE',
          gravidade: 'aviso',
          mensagem: `Em ${formato.nome} o comandante precisa ser ${rc.raridadeDoComandante === 'common' ? 'comum' : 'incomum'}: ${listar(fora.map(nomeDe))}.`,
          cartas: fora.map(nomeDe),
        });
      }
    }

    if (rc.feiticoAssinatura && comandantes.length > 0 && feiticos.length === 0) {
      achados.push({
        codigo: 'SEM_FEITICO_ASSINATURA',
        gravidade: 'aviso',
        mensagem: `${formato.nome} usa um feitiço-assinatura junto do planeswalker. Marque a mágica instantânea ou feitiço que fica na zona de comando.`,
      });
    }

    // ── Identidade de cor ─────────────────────────────────────────────────
    //
    // A regra que mais define a construção de um deck de Commander, e ela não
    // era verificada em nenhum lugar. Note que é `color_identity`, não
    // `colors`: um símbolo de mana no TEXTO da carta conta, então uma carta sem
    // cor nenhuma no custo pode ter identidade — é por isso que a Scryfall
    // manda os dois campos e só um serve aqui.
    if (rc.exigeIdentidadeDeCor && comandantes.length > 0) {
      const identidade = new Set<string>();
      let conheceIdentidade = false;
      for (const c of comandantes) {
        if (!c.colorIdentity) continue;
        conheceIdentidade = true;
        for (const cor of c.colorIdentity) identidade.add(cor);
      }
      identidadeDeCor = WUBRG.filter((c) => identidade.has(c));

      if (conheceIdentidade) {
        const fora = contaveis.filter((c) => {
          if (c.boardType === 'COMMANDER') return false;
          if (!c.colorIdentity) return false;
          return c.colorIdentity.some((cor) => !identidade.has(cor));
        });
        if (fora.length > 0) {
          const rotulo = identidadeDeCor.length
            ? identidadeDeCor.map((c) => NOME_DA_COR[c]).join(', ')
            : 'incolor';
          achados.push({
            codigo: 'IDENTIDADE_DE_COR',
            gravidade: 'aviso',
            mensagem: `A identidade do comandante é ${rotulo}. Fora dela: ${listar(fora.map(nomeDe))}.`,
            cartas: fora.map(nomeDe),
          });
        }
      }
    }
  } else if (comandantes.length > 0) {
    achados.push({
      codigo: 'COMANDANTES_DEMAIS',
      gravidade: 'aviso',
      mensagem: `${formato.nome} não usa zona de comando; a carta marcada como comandante entra no grimório.`,
      cartas: comandantes.map(nomeDe),
    });
  }

  return {
    formato,
    total,
    totalReserva,
    achados,
    podeEntrarNaMesa: !achados.some((a) => a.gravidade === 'erro'),
    identidadeDeCor,
  };
}

/**
 * O PRIMEIRO erro, como texto — para o `BadRequestException` do backend.
 *
 * Devolve `null` quando o deck pode entrar. Quem chama decide se lança.
 *
 * ─── POR QUE O PRIMEIRO, E NÃO TODOS ──────────────────────────────────────
 *
 * Um deck de 40 cartas sem comandante erra nas duas coisas. Juntar as duas
 * mensagens num parágrafo faz o jogador ler duas instruções sem saber por qual
 * começar — e a segunda costuma desaparecer quando ele resolve a primeira (um
 * deck completo de Commander quase sempre já tem o comandante marcado). Os
 * achados são empilhados na ordem de "o que resolver primeiro": tamanho,
 * comandante, banidas.
 *
 * A lista completa continua em `avaliarLegalidade` — é o que o painel de
 * legalidade do deckbuilder mostra, onde ver tudo de uma vez é o que se quer.
 */
export function motivoDeBloqueio(deck: DeckValidavel, formatoDaSala?: string): string | null {
  const { achados } = avaliarLegalidade(deck, formatoDaSala);
  return achados.find((a) => a.gravidade === 'erro')?.mensagem ?? null;
}
