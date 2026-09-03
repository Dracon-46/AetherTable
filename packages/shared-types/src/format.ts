/**
 * format.ts — o preset declarativo de um formato de Magic (DOC-037).
 *
 * ─── POR QUE ISTO PRECISAVA EXISTIR ────────────────────────────────────────
 *
 * DOC-037 §1 define a tese do produto: "formato é dado, não código". O catálogo
 * enumera 40+ formatos e diz explicitamente que os presets vivem aqui, em
 * `shared-types`, versionados com o código. Nada disso estava implementado.
 *
 * No lugar havia três listas independentes, cada uma com uma verdade diferente
 * sobre quais formatos existem:
 *
 *   - `apps/backend-core/src/decks/formato.ts` — 8 formatos, só tamanho de deck
 *     e comandante;
 *   - o `<select>` do deckbuilder — 7 formatos, escritos à mão no JSX;
 *   - o `<select>` de criar mesa no painel — 4 formatos, em MAIÚSCULAS.
 *
 * O sintoma que o usuário relatou sai direto disso: o aviso "o formato
 * Commander exige exatas 100" era um `if` fixo no componente, sem consultar
 * formato nenhum, então ele aparecia num deck de Modern — onde a regra é
 * "mínimo 60" e 100 cartas está perfeitamente legal. O aviso não estava
 * errado por descuido de texto; ele estava errado porque não havia onde
 * perguntar qual é a regra.
 *
 * ─── O QUE UM PRESET RESPONDE ──────────────────────────────────────────────
 *
 * As seis perguntas de DOC-037 §1: quantos jogadores, times e vida
 * compartilhada, vida e mão inicial, que avisos de deck, quais zonas, e se
 * precisa de comandante ou baralho extra.
 *
 * ─── A BANLIST NÃO É NOSSA ─────────────────────────────────────────────────
 *
 * `legalityKey` é a chave do objeto `legalities` que a Scryfall devolve em toda
 * carta (`standard`, `modern`, `commander`, `paupercommander`…). Reaproveitá-la
 * significa que a banlist chega atualizada de graça e nós não mantemos lista
 * nenhuma — que é a única forma sustentável disso funcionar, porque a banlist
 * muda por anúncio da Wizards, não por deploy nosso.
 */

import type { Zone } from './zones';

/** Agrupamento para a interface — não tem efeito em regra nenhuma. */
export const CATEGORIAS_DE_FORMATO = [
  'CONSTRUIDO',
  'COMANDANTE',
  'CASUAL',
  'LIMITADO',
  'VARIANTE',
] as const;
export type CategoriaDeFormato = (typeof CATEGORIAS_DE_FORMATO)[number];

/**
 * Maturidade do preset no sistema.
 *
 *   'ESTAVEL'    — jogável hoje, todas as regras do preset valem.
 *   'BETA'       — jogável, mas alguma peça é aproximada.
 *   'PLANEJADO'  — o preset existe como dado e a MÁQUINA que ele exige não.
 *
 * `PLANEJADO` não é decoração: ele deixa o catálogo honesto. Sem esse estado, a
 * escolha seria entre esconder trinta formatos (e o produto parecer ter seis) ou
 * oferecê-los como se funcionassem (e o jogador descobrir na mesa que o baralho
 * de esquemas não existe).
 */
export const STATUS_DE_FORMATO = ['ESTAVEL', 'BETA', 'PLANEJADO'] as const;
export type StatusDeFormato = (typeof STATUS_DE_FORMATO)[number];

/** Baralho fora do grimório principal, com zona própria (DOC-037 §8). */
export const BARALHOS_EXTRA = [
  'PLANAR',
  'SCHEME',
  'VANGUARD',
  'ATTRACTION',
  'CONTRAPTION',
  'STICKER',
  'HORDE',
  'CUBE',
] as const;
export type BaralhoExtra = (typeof BARALHOS_EXTRA)[number];

/** Teto de raridade — Pauper e Peasant. */
export type TetoDeRaridade = 'common' | 'uncommon';

export interface RegrasDeDeck {
  /** Mínimo de cartas contáveis. `null` = sem mínimo (Freeform). */
  minimo: number | null;
  /** Máximo. `null` = sem máximo. */
  maximo: number | null;
  /** Tamanho EXATO. Quando definido, vence mínimo e máximo (Commander: 100). */
  exato: number | null;
  /** Uma cópia de cada carta, exceto terrenos básicos. */
  singleton: boolean;
  /** Cópias por carta fora do singleton. 4 no construído. */
  maxCopias: number;
  /** Faixa da reserva. `null` = o formato não tem reserva. */
  reserva: { min: number; max: number } | null;
  /** Toda carta precisa ser desta raridade ou menor. `null` = sem teto. */
  tetoDeRaridade: TetoDeRaridade | null;
  /** Custo de mana convertido máximo (Tiny Leaders: 3). */
  maxValorDeMana: number | null;
  /** Chave em `legalities` da Scryfall. `null` = a Scryfall não cobre. */
  chaveDeLegalidade: string | null;
  /** Formato com lista de pontos (Canadian Highlander). Só aviso. */
  listaDePontos: boolean;
}

export interface RegrasDeComandante {
  /**
   * Faixa de cartas na zona de comando.
   *
   * ─── POR QUE UMA FAIXA, E NÃO UM NÚMERO ──────────────────────────────────
   *
   * Commander pede UM comandante, mas aceita DOIS quando a dupla tem Partner,
   * Background ou "Friends forever". Essas habilidades vivem no TEXTO da carta
   * — a Scryfall não devolve um campo estruturado para elas — então o sistema
   * não tem como saber se a dupla escolhida é uma dupla legal.
   *
   * Num sandbox, a resposta certa para "não consigo verificar" é permitir e
   * avisar, nunca proibir: proibir dois comandantes trancaria fora da mesa
   * todo deck de parceiros, que é legal e comum. O mínimo é o que a mesa
   * PRECISA (sem comandante a zona de comando nasce vazia); o máximo é o teto
   * acima do qual não existe regra de formato nenhum.
   */
  quantidade: { minimo: number; maximo: number };
  /** O que pode ser comandante. Oathbreaker usa planeswalker. */
  tipo: 'creature' | 'planeswalker';
  /** Oathbreaker: a segunda carta da zona de comando é um feitiço. */
  feiticoAssinatura: boolean;
  /** Avisa quando uma carta sai da identidade de cor do comandante. */
  exigeIdentidadeDeCor: boolean;
  /** Taxa cumulativa de +2 ao reconjurar. */
  taxa: boolean;
  /** Teto de raridade do PRÓPRIO comandante (PDH: incomum). */
  raridadeDoComandante: TetoDeRaridade | null;
}

export interface FormatPreset {
  id: string;
  nome: string;
  categoria: CategoriaDeFormato;
  status: StatusDeFormato;
  /** Uma linha para a interface: o que este formato é. */
  resumo: string;

  jogadores: { min: number; max: number; padrao: number };
  /** `null` quando o formato não tem times. */
  times: { tamanho: number; vidaCompartilhada: boolean } | null;

  vidaInicial: number;
  maoInicial: number;
  /** `null` = sem limite de mão (Freeform). */
  maxMao: number | null;

  deck: RegrasDeDeck;
  /** `null` quando o formato não usa zona de comando. */
  comandante: RegrasDeComandante | null;

  zonas: Zone[];
  baralhosExtra: BaralhoExtra[];
  /** `true` = precisa do subsistema de draft, que não existe (DOC-037 §6). */
  exigeMotorDeDraft: boolean;
}

// ─── Blocos reutilizados ─────────────────────────────────────────────────────

/** As zonas que TODA mesa tem. */
const ZONAS_BASE: Zone[] = ['LIBRARY', 'HAND', 'BATTLEFIELD', 'GRAVEYARD', 'EXILE', 'STACK'];
const ZONAS_CONSTRUIDO: Zone[] = [...ZONAS_BASE, 'SIDEBOARD'];
const ZONAS_COMANDANTE: Zone[] = [...ZONAS_BASE, 'COMMAND', 'SIDEBOARD'];

/** Construído: ≥60, 4 cópias, reserva de até 15. É a forma de 12 formatos. */
function construido(
  id: string,
  nome: string,
  chaveDeLegalidade: string | null,
  status: StatusDeFormato = 'ESTAVEL',
  extra: Partial<RegrasDeDeck> = {},
): FormatPreset {
  return {
    id,
    nome,
    categoria: 'CONSTRUIDO',
    status,
    resumo: 'Duelo de 60 cartas, até 4 cópias de cada, reserva de 15.',
    jogadores: { min: 2, max: 8, padrao: 2 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 60,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 4,
      reserva: { min: 0, max: 15 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade,
      listaDePontos: false,
      ...extra,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  };
}

/** Comandante: singleton, zona de comando, identidade de cor. */
function comandante(
  id: string,
  nome: string,
  opcoes: {
    nome?: string;
    tamanho: number;
    vida: number;
    jogadores: { min: number; max: number; padrao: number };
    chaveDeLegalidade: string | null;
    status?: StatusDeFormato;
    resumo: string;
    deck?: Partial<RegrasDeDeck>;
    comandante?: Partial<RegrasDeComandante>;
    times?: { tamanho: number; vidaCompartilhada: boolean } | null;
  },
): FormatPreset {
  return {
    id,
    nome,
    categoria: 'COMANDANTE',
    status: opcoes.status ?? 'ESTAVEL',
    resumo: opcoes.resumo,
    jogadores: opcoes.jogadores,
    times: opcoes.times ?? null,
    vidaInicial: opcoes.vida,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: opcoes.tamanho,
      maximo: opcoes.tamanho,
      exato: opcoes.tamanho,
      singleton: true,
      maxCopias: 1,
      // Commander não tem reserva pelas regras oficiais; a zona existe na mesa
      // como área de anotação, então o teto é 0 e o aviso diz isso.
      reserva: null,
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: opcoes.chaveDeLegalidade,
      listaDePontos: false,
      ...opcoes.deck,
    },
    comandante: {
      quantidade: { minimo: 1, maximo: 2 },
      tipo: 'creature',
      feiticoAssinatura: false,
      exigeIdentidadeDeCor: true,
      taxa: true,
      raridadeDoComandante: null,
      ...opcoes.comandante,
    },
    zonas: ZONAS_COMANDANTE,
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  };
}

// ─── O catálogo ──────────────────────────────────────────────────────────────

/**
 * ORDEM IMPORTA: é a ordem em que os formatos aparecem no seletor.
 *
 * Commander primeiro porque é o formato-vitrine (DOC-037), e `freeform` logo
 * depois porque DOC-037 §1.2 argumenta que ele é provavelmente o mais usado —
 * é o que permite jogar um formato caseiro sem o sistema julgar nada.
 */
export const FORMATOS: readonly FormatPreset[] = [
  comandante('commander', 'Commander / EDH', {
    tamanho: 100,
    vida: 40,
    jogadores: { min: 2, max: 8, padrao: 4 },
    chaveDeLegalidade: 'commander',
    resumo: '100 cartas singleton, um comandante lendário, 40 de vida.',
  }),

  {
    id: 'freeform',
    nome: 'Mesa de cozinha (livre)',
    categoria: 'CASUAL',
    status: 'ESTAVEL',
    resumo: 'Zero validação. Qualquer deck, qualquer carta, vida configurável.',
    jogadores: { min: 1, max: 8, padrao: 4 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: null,
    deck: {
      minimo: null,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 99,
      reserva: { min: 0, max: 99 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: [...ZONAS_COMANDANTE],
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  },

  // ── Construídos ──────────────────────────────────────────────────────────
  construido('standard', 'Standard', 'standard'),
  construido('pioneer', 'Pioneer', 'pioneer'),
  construido('modern', 'Modern', 'modern'),
  construido('legacy', 'Legacy', 'legacy'),
  // Vintage é o único formato com RESTRITAS: máximo 1 cópia, distinto de
  // banida. A Scryfall marca como `legalities.vintage === 'restricted'`, e o
  // validador trata isso à parte — ver `legalidade.ts`.
  construido('vintage', 'Vintage', 'vintage'),
  construido('pauper', 'Pauper', 'pauper', 'ESTAVEL', { tetoDeRaridade: 'common' }),
  construido('premodern', 'Premodern', 'premodern'),
  construido('oldschool', 'Old School 93/94', 'oldschool'),
  construido('historic', 'Historic', 'historic'),
  construido('timeless', 'Timeless', 'timeless'),
  construido('alchemy', 'Alchemy', 'alchemy'),
  construido('explorer', 'Explorer', 'explorer'),
  // Peasant e Artisan não têm chave na Scryfall: o teto de raridade é a regra
  // inteira, e ela é verificável sem banlist.
  construido('peasant', 'Peasant', null, 'BETA', { tetoDeRaridade: 'uncommon' }),
  construido('artisan', 'Artisan', null, 'BETA', { tetoDeRaridade: 'uncommon' }),

  // ── Comandante ───────────────────────────────────────────────────────────
  comandante('duel_commander', 'Duel Commander', {
    tamanho: 100,
    vida: 20,
    jogadores: { min: 2, max: 2, padrao: 2 },
    chaveDeLegalidade: 'duel',
    resumo: 'Commander 1v1 com banlist própria e 20 de vida.',
  }),
  comandante('commander_1v1', 'Commander 1v1 (MTGO)', {
    tamanho: 100,
    vida: 30,
    jogadores: { min: 2, max: 2, padrao: 2 },
    chaveDeLegalidade: 'commander',
    resumo: 'Commander a dois, 30 de vida.',
  }),
  comandante('brawl', 'Brawl', {
    tamanho: 60,
    vida: 25,
    jogadores: { min: 2, max: 4, padrao: 2 },
    chaveDeLegalidade: 'brawl',
    resumo: '60 cartas singleton do Standard, um comandante, 25 de vida.',
  }),
  comandante('historic_brawl', 'Historic Brawl', {
    tamanho: 100,
    vida: 25,
    jogadores: { min: 2, max: 4, padrao: 2 },
    chaveDeLegalidade: 'historicbrawl',
    resumo: '100 cartas singleton do Historic, um comandante.',
  }),
  comandante('oathbreaker', 'Oathbreaker', {
    tamanho: 60,
    vida: 20,
    jogadores: { min: 2, max: 4, padrao: 4 },
    chaveDeLegalidade: 'oathbreaker',
    resumo: '60 singleton, um planeswalker e o feitiço-assinatura dele.',
    // Oathbreaker não tem parceiros: é UM planeswalker, e a segunda carta da
    // zona de comando é o feitiço-assinatura, que tem board type próprio.
    comandante: {
      quantidade: { minimo: 1, maximo: 1 },
      tipo: 'planeswalker',
      feiticoAssinatura: true,
    },
  }),
  comandante('pdh', 'Pauper EDH', {
    tamanho: 100,
    vida: 40,
    jogadores: { min: 2, max: 6, padrao: 4 },
    chaveDeLegalidade: 'paupercommander',
    resumo: '100 singleton só de comuns; o comandante é uma criatura incomum.',
    deck: { tetoDeRaridade: 'common' },
    comandante: { raridadeDoComandante: 'uncommon' },
  }),
  comandante('tiny_leaders', 'Tiny Leaders', {
    tamanho: 50,
    vida: 25,
    jogadores: { min: 2, max: 2, padrao: 2 },
    chaveDeLegalidade: null,
    status: 'BETA',
    resumo: '50 singleton, nenhuma carta acima de custo 3.',
    deck: { maxValorDeMana: 3 },
  }),
  {
    ...comandante('canlander', 'Canadian Highlander', {
      tamanho: 100,
      vida: 20,
      jogadores: { min: 2, max: 2, padrao: 2 },
      chaveDeLegalidade: null,
      status: 'BETA',
      resumo: '100 singleton, sem comandante, com lista de pontos.',
      deck: { listaDePontos: true },
    }),
    // Highlander canadense NÃO tem comandante, apesar de ser um singleton de
    // 100. Sem este `null`, o validador exigiria uma carta na zona de comando
    // e o deck legal apareceria como inválido.
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
  },
  {
    ...comandante('commander_2hg', 'Commander Two-Headed Giant', {
      tamanho: 100,
      vida: 30,
      jogadores: { min: 4, max: 4, padrao: 4 },
      chaveDeLegalidade: 'commander',
      // PLANEJADO e não BETA: vida compartilhada exige mover `life` do
      // `Player` para um `Team` no schema do Colyseus (DOC-037 §5.1). Enquanto
      // isso não existe, cada jogador tem a própria vida — quer dizer, o
      // formato não é o formato.
      status: 'PLANEJADO',
      resumo: 'Commander em duplas, 30 de vida COMPARTILHADA por time.',
      times: { tamanho: 2, vidaCompartilhada: true },
    }),
  },
  {
    ...comandante('commander_emperor', 'Commander Emperor', {
      tamanho: 100,
      vida: 40,
      jogadores: { min: 6, max: 6, padrao: 6 },
      chaveDeLegalidade: 'commander',
      status: 'PLANEJADO',
      resumo: 'Commander 3v3, com imperador e generais.',
      times: { tamanho: 3, vidaCompartilhada: false },
    }),
  },

  // ── Casuais e nativos do sandbox ─────────────────────────────────────────
  {
    id: 'solo',
    nome: 'Teste solo',
    categoria: 'CASUAL',
    status: 'ESTAVEL',
    // DOC-037 §7.1: jogar sozinho é o caso de uso nº 1 do documento de visão
    // ("O Testador — vale a pena comprar?"), e o mínimo de jogadores nunca
    // tinha previsto uma mesa de um.
    resumo: 'Uma mesa só sua, para testar um deck antes de comprar as cartas.',
    jogadores: { min: 1, max: 1, padrao: 1 },
    times: null,
    vidaInicial: 40,
    maoInicial: 7,
    maxMao: null,
    deck: {
      minimo: null,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 99,
      reserva: { min: 0, max: 99 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: [...ZONAS_COMANDANTE],
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  },
  {
    id: 'singleton',
    nome: 'Highlander (60 singleton)',
    categoria: 'CASUAL',
    status: 'ESTAVEL',
    resumo: '60 cartas, uma cópia de cada, sem comandante.',
    jogadores: { min: 2, max: 8, padrao: 2 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 60,
      maximo: null,
      exato: null,
      singleton: true,
      maxCopias: 1,
      reserva: { min: 0, max: 15 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  },

  // ── Limitados ────────────────────────────────────────────────────────────
  //
  // Sealed e Jumpstart não precisam do motor de draft, só de GERAÇÃO DE PACOTE
  // (DOC-037 §6.1) — que também não existe ainda. Os outros precisam do
  // subsistema inteiro. Os dois casos ficam PLANEJADOS, com o motivo à vista.
  {
    id: 'sealed',
    nome: 'Sealed Deck',
    categoria: 'LIMITADO',
    status: 'PLANEJADO',
    resumo: 'Seis pacotes abertos, deck de 40 montado na hora.',
    jogadores: { min: 1, max: 8, padrao: 2 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 40,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 99,
      reserva: { min: 0, max: 99 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: [],
    exigeMotorDeDraft: false,
  },
  {
    id: 'booster_draft',
    nome: 'Booster Draft',
    categoria: 'LIMITADO',
    status: 'PLANEJADO',
    resumo: 'Três pacotes passando em roda. Precisa do motor de draft.',
    jogadores: { min: 4, max: 8, padrao: 8 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 40,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 99,
      reserva: { min: 0, max: 99 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: ['CUBE'],
    exigeMotorDeDraft: true,
  },
  {
    id: 'cube_draft',
    nome: 'Cube Draft',
    categoria: 'LIMITADO',
    status: 'PLANEJADO',
    resumo: 'Pacotes gerados de uma lista de cubo. Precisa do motor de draft.',
    jogadores: { min: 4, max: 8, padrao: 8 },
    times: null,
    vidaInicial: 20,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 40,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 99,
      reserva: { min: 0, max: 99 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: ['CUBE'],
    exigeMotorDeDraft: true,
  },

  // ── Variantes com baralho extra ──────────────────────────────────────────
  {
    id: 'planechase',
    nome: 'Planechase',
    categoria: 'VARIANTE',
    status: 'PLANEJADO',
    resumo: 'Commander com baralho planar e dado planar.',
    jogadores: { min: 2, max: 6, padrao: 4 },
    times: null,
    vidaInicial: 40,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 100,
      maximo: 100,
      exato: 100,
      singleton: true,
      maxCopias: 1,
      reserva: null,
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: 'commander',
      listaDePontos: false,
    },
    comandante: {
      quantidade: { minimo: 1, maximo: 2 },
      tipo: 'creature',
      feiticoAssinatura: false,
      exigeIdentidadeDeCor: true,
      taxa: true,
      raridadeDoComandante: null,
    },
    zonas: ZONAS_COMANDANTE,
    baralhosExtra: ['PLANAR'],
    exigeMotorDeDraft: false,
  },
  {
    id: 'archenemy',
    nome: 'Archenemy',
    categoria: 'VARIANTE',
    status: 'PLANEJADO',
    resumo: 'Um arquinimigo com baralho de esquemas contra os demais.',
    jogadores: { min: 3, max: 4, padrao: 4 },
    times: { tamanho: 3, vidaCompartilhada: false },
    vidaInicial: 40,
    maoInicial: 7,
    maxMao: 7,
    deck: {
      minimo: 60,
      maximo: null,
      exato: null,
      singleton: false,
      maxCopias: 4,
      reserva: { min: 0, max: 15 },
      tetoDeRaridade: null,
      maxValorDeMana: null,
      chaveDeLegalidade: null,
      listaDePontos: false,
    },
    comandante: null,
    zonas: ZONAS_CONSTRUIDO,
    baralhosExtra: ['SCHEME'],
    exigeMotorDeDraft: false,
  },
] as const;

// ─── Consulta ────────────────────────────────────────────────────────────────

const PORID = new Map<string, FormatPreset>(FORMATOS.map((f) => [f.id, f]));

/** O preset padrão quando o id não é reconhecido. Ver `acharFormato`. */
export const FORMATO_PADRAO = PORID.get('commander')!;

/**
 * Preset por id, com recuo para Commander.
 *
 * NUNCA devolve `undefined` de propósito: todo chamador é um caminho em que o
 * deck já existe no banco com aquele `formatId`, e devolver `undefined` faria
 * um formato removido do catálogo virar uma tela em branco em vez de um deck
 * que continua abrindo. Um id desconhecido é um problema nosso, não do jogador.
 */
export function acharFormato(id?: string | null): FormatPreset {
  if (!id) return FORMATO_PADRAO;
  return PORID.get(String(id).toLowerCase()) ?? FORMATO_PADRAO;
}

/** `true` quando o id existe no catálogo — para validar entrada do cliente. */
export function formatoExiste(id?: string | null): boolean {
  return Boolean(id) && PORID.has(String(id).toLowerCase());
}

/** Só os formatos jogáveis hoje. Alimenta os seletores. */
export const FORMATOS_JOGAVEIS: readonly FormatPreset[] = FORMATOS.filter(
  (f) => f.status !== 'PLANEJADO',
);

/** Rótulo legível de uma regra de tamanho, para a interface. */
export function descreverTamanho(deck: RegrasDeDeck): string {
  if (deck.exato !== null) return `exatamente ${deck.exato} cartas`;
  if (deck.minimo !== null && deck.maximo !== null) {
    return `entre ${deck.minimo} e ${deck.maximo} cartas`;
  }
  if (deck.minimo !== null) return `no mínimo ${deck.minimo} cartas`;
  if (deck.maximo !== null) return `no máximo ${deck.maximo} cartas`;
  return 'qualquer número de cartas';
}
