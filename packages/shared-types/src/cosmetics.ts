/**
 * cosmetics.ts — catalogo fechado de cosmeticos (DOC-060).
 *
 * ─── DUAS DECISOES QUE MOLDAM ESTE ARQUIVO ─────────────────────────────────
 *
 * 1. SISTEMA FECHADO, SEM UPLOAD (DOC-060 §1.1). Playmats e sleeves saem de um
 *    catalogo pre-aprovado. Upload livre traria dois riscos que nenhuma
 *    moderacao reativa cobre: propriedade intelectual da WotC e conteudo
 *    sensivel numa mesa que pode ter menores.
 *
 * 2. TUDO PROCEDURAL. Cada item e descrito por cores e um nome de padrao —
 *    nao por um arquivo de imagem. O cliente desenha. Isso significa:
 *      - zero bytes de asset para servir e versionar;
 *      - nenhuma arte de terceiros para revisar;
 *      - nitidez em qualquer resolucao, sem pack de @2x/@3x;
 *      - o catalogo inteiro cabe no bundle e funciona offline.
 *
 * ─── AVISO DE DIREITO AUTORAL ──────────────────────────────────────────────
 *
 * DOC-060 §2.1 e explicito: o verso oficial das cartas de Magic e propriedade
 * da WotC e NAO deve ser usado, nem como padrao nem como item. O codigo
 * anterior carregava `https://back.scryfall.io/large/back.jpg` — que e
 * exatamente esse verso — para toda carta oculta da mesa. O sleeve padrao
 * abaixo (`aether-classic`) existe para ocupar esse lugar.
 */

export type CosmeticTier = 'FREE' | 'APOIADOR';

export interface Sleeve {
  id: string;
  nome: string;
  tier: CosmeticTier;
  /** Fundo do sleeve, de fora para dentro. */
  cores: [string, string];
  /** Cor da borda desenhada na carta. */
  borda: string;
  /** Cor do monograma / trama. */
  detalhe: string;
  padrao: 'losango' | 'raios' | 'ondas' | 'grade' | 'liso' | 'circuito';
}

export interface Playmat {
  id: string;
  nome: string;
  tier: CosmeticTier;
  /** Gradiente do fundo da area de jogo. */
  cores: [string, string];
  destaque: string;
  padrao: 'nebulosa' | 'hexagonos' | 'linhas' | 'liso' | 'runas';
}

export interface ProfileBorder {
  id: string;
  nome: string;
  tier: CosmeticTier;
  /**
   * Classe CSS aplicada ao avatar. DOC-060 §2.4 recomenda CSS puro: custo de
   * CPU praticamente nulo, ao contrario de GIF/WebM em loop.
   */
  classe: string;
}

export interface ChatTitle {
  id: string;
  nome: string;
  tier: CosmeticTier;
  /** Texto do badge exibido ao lado do nome. */
  badge: string;
  cor: string;
}

/**
 * Mascote da mesa. Nao esta em DOC-060 — e uma extensao natural da mesma
 * politica: procedural, sem upload, puramente decorativo, e some junto com os
 * demais cosmeticos quando o oponente desliga cosmeticos alheios.
 */
export interface Pet {
  id: string;
  nome: string;
  tier: CosmeticTier;
  /** Silhueta desenhada no canvas. */
  forma: 'dragao' | 'coruja' | 'gato' | 'slime' | 'fenix' | 'nenhum';
  cor: string;
  /** Como o mascote se move — sempre discreto: nunca compete com as cartas. */
  animacao: 'flutuar' | 'pulsar' | 'balancar';
}

// ─── Catalogo ────────────────────────────────────────────────────────────────

export const SLEEVES: readonly Sleeve[] = [
  {
    id: 'aether-classic',
    nome: 'AetherTable Clássico',
    tier: 'FREE',
    cores: ['#2b3350', '#161a2c'],
    borda: '#4b5578',
    detalhe: '#7c8ac4',
    padrao: 'losango',
  },
  {
    id: 'mana-branco',
    nome: 'Planície',
    tier: 'FREE',
    cores: ['#d8d2b4', '#8f8a72'],
    borda: '#efe9cd',
    detalhe: '#fffbe6',
    padrao: 'raios',
  },
  {
    id: 'mana-azul',
    nome: 'Ilha',
    tier: 'FREE',
    cores: ['#1d4e78', '#0d2540'],
    borda: '#3d7fb5',
    detalhe: '#9fd0f0',
    padrao: 'ondas',
  },
  {
    id: 'mana-preto',
    nome: 'Pântano',
    tier: 'FREE',
    cores: ['#2a2530', '#131016'],
    borda: '#4b4356',
    detalhe: '#9d92ab',
    padrao: 'liso',
  },
  {
    id: 'mana-vermelho',
    nome: 'Montanha',
    tier: 'FREE',
    cores: ['#7a2c1e', '#3a140d'],
    borda: '#b8543c',
    detalhe: '#f0a48c',
    padrao: 'raios',
  },
  {
    id: 'mana-verde',
    nome: 'Floresta',
    tier: 'FREE',
    cores: ['#255138', '#0f2419'],
    borda: '#4a8a63',
    detalhe: '#9fd4b0',
    padrao: 'ondas',
  },
  {
    id: 'circuito',
    nome: 'Circuito Etéreo',
    tier: 'APOIADOR',
    cores: ['#0f2b2e', '#061416'],
    borda: '#1f7a80',
    detalhe: '#57e2e5',
    padrao: 'circuito',
  },
  {
    id: 'prisma',
    nome: 'Prisma',
    tier: 'APOIADOR',
    cores: ['#3b1d5e', '#12082a'],
    borda: '#8b5cf6',
    detalhe: '#e9d5ff',
    padrao: 'grade',
  },
] as const;

export const PLAYMATS: readonly Playmat[] = [
  {
    id: 'mesa-padrao',
    nome: 'Mesa Padrão',
    tier: 'FREE',
    cores: ['#1e2836', '#141a24'],
    destaque: '#2b3a4d',
    padrao: 'liso',
  },
  {
    id: 'nebulosa',
    nome: 'Nebulosa',
    tier: 'FREE',
    cores: ['#231b3d', '#0d0a18'],
    destaque: '#6d4bd6',
    padrao: 'nebulosa',
  },
  {
    id: 'floresta',
    nome: 'Clareira',
    tier: 'FREE',
    cores: ['#16301f', '#0a1710'],
    destaque: '#2f7a4a',
    padrao: 'runas',
  },
  {
    id: 'forja',
    nome: 'Forja',
    tier: 'FREE',
    cores: ['#33170f', '#160907'],
    destaque: '#b8542f',
    padrao: 'linhas',
  },
  {
    id: 'arcano',
    nome: 'Salão Arcano',
    tier: 'APOIADOR',
    cores: ['#101f38', '#070d18'],
    destaque: '#3f7fd6',
    padrao: 'hexagonos',
  },
  {
    id: 'aurora',
    nome: 'Aurora',
    tier: 'APOIADOR',
    cores: ['#0b2a2b', '#041213'],
    destaque: '#37c9a6',
    padrao: 'nebulosa',
  },
] as const;

export const PROFILE_BORDERS: readonly ProfileBorder[] = [
  { id: 'nenhuma', nome: 'Sem borda', tier: 'FREE', classe: '' },
  { id: 'brilho-azul', nome: 'Brilho Azul', tier: 'FREE', classe: 'borda-brilho-azul' },
  { id: 'brilho-ouro', nome: 'Brilho Dourado', tier: 'FREE', classe: 'borda-brilho-ouro' },
  { id: 'neon-verde', nome: 'Neon Verde', tier: 'FREE', classe: 'borda-neon-verde' },
  { id: 'prisma-rotativo', nome: 'Prisma Rotativo', tier: 'APOIADOR', classe: 'borda-prisma' },
  { id: 'chama', nome: 'Chama', tier: 'APOIADOR', classe: 'borda-chama' },
] as const;

export const CHAT_TITLES: readonly ChatTitle[] = [
  { id: 'nenhum', nome: 'Sem título', tier: 'FREE', badge: '', cor: '' },
  { id: 'planeswalker', nome: 'Planeswalker', tier: 'FREE', badge: 'Planeswalker', cor: '#3B82F6' },
  { id: 'novato', nome: 'Recém-chegado', tier: 'FREE', badge: 'Recém-chegado', cor: '#22C55E' },
  { id: 'apoiador', nome: 'Apoiador', tier: 'APOIADOR', badge: 'Apoiador', cor: '#F59E0B' },
  { id: 'patrono', nome: 'Patrono', tier: 'APOIADOR', badge: 'Patrono', cor: '#A855F7' },
  { id: 'mitico', nome: 'Apoiador Mítico', tier: 'APOIADOR', badge: 'Mítico', cor: '#EF4444' },
] as const;

export const PETS: readonly Pet[] = [
  {
    id: 'nenhum',
    nome: 'Nenhum',
    tier: 'FREE',
    forma: 'nenhum',
    cor: '#000000',
    animacao: 'flutuar',
  },
  { id: 'slime', nome: 'Slime', tier: 'FREE', forma: 'slime', cor: '#4ade80', animacao: 'pulsar' },
  {
    id: 'coruja',
    nome: 'Coruja',
    tier: 'FREE',
    forma: 'coruja',
    cor: '#c4a484',
    animacao: 'balancar',
  },
  { id: 'gato', nome: 'Gato', tier: 'FREE', forma: 'gato', cor: '#94a3b8', animacao: 'balancar' },
  {
    id: 'dragao',
    nome: 'Dragonete',
    tier: 'APOIADOR',
    forma: 'dragao',
    cor: '#ef4444',
    animacao: 'flutuar',
  },
  {
    id: 'fenix',
    nome: 'Fênix',
    tier: 'APOIADOR',
    forma: 'fenix',
    cor: '#fb923c',
    animacao: 'flutuar',
  },
] as const;

// ─── Acesso ──────────────────────────────────────────────────────────────────

export const SLEEVE_PADRAO = 'aether-classic';
export const PLAYMAT_PADRAO = 'mesa-padrao';
export const BORDER_PADRAO = 'nenhuma';
export const TITLE_PADRAO = 'nenhum';
export const PET_PADRAO = 'nenhum';

/** O conjunto que o jogador tem equipado. */
export interface CosmeticosEquipados {
  sleeveId: string;
  playmatId: string;
  borderId: string;
  titleId: string;
  petId: string;
}

export const COSMETICOS_PADRAO: CosmeticosEquipados = {
  sleeveId: SLEEVE_PADRAO,
  playmatId: PLAYMAT_PADRAO,
  borderId: BORDER_PADRAO,
  titleId: TITLE_PADRAO,
  petId: PET_PADRAO,
};

const porId = <T extends { id: string }>(itens: readonly T[]) =>
  new Map(itens.map((i) => [i.id, i]));

const MAPA_SLEEVES = porId(SLEEVES);
const MAPA_PLAYMATS = porId(PLAYMATS);
const MAPA_BORDERS = porId(PROFILE_BORDERS);
const MAPA_TITLES = porId(CHAT_TITLES);
const MAPA_PETS = porId(PETS);

/**
 * Resolvedores. Sempre devolvem um item: um id desconhecido — de uma versao
 * mais nova do catalogo, ou de um cliente adulterado — cai no padrao em vez de
 * deixar a mesa sem sleeve.
 */
export const acharSleeve = (id?: string): Sleeve =>
  MAPA_SLEEVES.get(id ?? '') ?? MAPA_SLEEVES.get(SLEEVE_PADRAO)!;
export const acharPlaymat = (id?: string): Playmat =>
  MAPA_PLAYMATS.get(id ?? '') ?? MAPA_PLAYMATS.get(PLAYMAT_PADRAO)!;
export const acharBorder = (id?: string): ProfileBorder =>
  MAPA_BORDERS.get(id ?? '') ?? MAPA_BORDERS.get(BORDER_PADRAO)!;
export const acharTitle = (id?: string): ChatTitle =>
  MAPA_TITLES.get(id ?? '') ?? MAPA_TITLES.get(TITLE_PADRAO)!;
export const acharPet = (id?: string): Pet => MAPA_PETS.get(id ?? '') ?? MAPA_PETS.get(PET_PADRAO)!;

/** O id existe no catalogo? Usado pelo servidor antes de gravar no estado. */
export const ehSleeveValido = (id: string) => MAPA_SLEEVES.has(id);
export const ehPlaymatValido = (id: string) => MAPA_PLAYMATS.has(id);
export const ehBorderValido = (id: string) => MAPA_BORDERS.has(id);
export const ehTitleValido = (id: string) => MAPA_TITLES.has(id);
export const ehPetValido = (id: string) => MAPA_PETS.has(id);

// ─── DIREITO DE EQUIPAR ───────────────────────────────────────────────────────

/** As cinco famílias, na forma em que o perfil as recebe. */
export type FamiliaDeCosmetico = keyof CosmeticosEquipados;

/**
 * O tier de um item, por família. Um id desconhecido devolve `'FREE'` — pelo
 * mesmo motivo dos resolvedores acima: um id fora do catálogo cai no padrão, e
 * o padrão é sempre gratuito.
 */
export function tierDoCosmetico(familia: FamiliaDeCosmetico, id: string): CosmeticTier {
  switch (familia) {
    case 'sleeveId':
      return MAPA_SLEEVES.get(id)?.tier ?? 'FREE';
    case 'playmatId':
      return MAPA_PLAYMATS.get(id)?.tier ?? 'FREE';
    case 'borderId':
      return MAPA_BORDERS.get(id)?.tier ?? 'FREE';
    case 'titleId':
      return MAPA_TITLES.get(id)?.tier ?? 'FREE';
    case 'petId':
      return MAPA_PETS.get(id)?.tier ?? 'FREE';
  }
}

/**
 * ─── O CADEADO PRECISA TRANCAR ────────────────────────────────────────────────
 *
 * `CosmeticPicker` desenhava um cadeado nos itens `APOIADOR` e o botão não
 * recebia `disabled`; o DTO do backend validava só a EXISTÊNCIA do id no
 * catálogo; e `updateUser` gravava direto. Qualquer conta equipava qualquer
 * coisa, e o cadeado era decoração.
 *
 * Esta função é a regra, num lugar só, chamada pelas duas pontas: o cliente
 * para desabilitar o botão e dizer por quê, o servidor para recusar. Duas
 * implementações divergiriam no primeiro item novo do catálogo — e a
 * divergência apareceria como um item que a tela deixa clicar e a API recusa.
 */
export function podeEquipar(
  tierDoUsuario: CosmeticTier,
  familia: FamiliaDeCosmetico,
  id: string,
): boolean {
  if (tierDoUsuario === 'APOIADOR') return true;
  return tierDoCosmetico(familia, id) === 'FREE';
}
