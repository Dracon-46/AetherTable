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

// ─── Catalogo autoral: itens criados pelo backoffice ─────────────────────────

/**
 * ─── POR QUE O CATALOGO PRECISOU DEIXAR DE SER SO CODIGO ───────────────────
 *
 * Ate aqui, criar um cosmetico exigia pull request neste arquivo mais um
 * deploy. Isso deixava a decisao "que cosmeticos o jogo tem" na mao de quem
 * tem acesso ao repositorio, e nao de quem administra o produto — e uma
 * promocao de fim de semana passava a depender de uma janela de release.
 *
 * O que NAO mudou e a razao de DOC-060 §1.1 existir. O catalogo continua
 * FECHADO: nao ha upload, nao entra arquivo de imagem, nao entra arte de
 * terceiros. O que o backoffice compoe sao COMBINACOES novas de primitivas que
 * ja estao no cliente — as seis tramas de sleeve, os cinco fundos de playmat,
 * as cinco silhuetas de mascote — mais cores. O vocabulario e fechado por
 * construcao: `padrao`, `forma` e `animacao` sao unioes de literais, e um
 * valor fora delas nao compila aqui nem sobrevive a `normalizarCosmeticoAutoral`.
 *
 * O resultado e que um item autoral e indistinguivel de um item de codigo para
 * todo o resto do sistema: mesmos campos, mesmo renderizador, mesmo resolvedor.
 * Ele so nasce em outro lugar.
 *
 * ─── TRES PROCESSOS PRECISAM CONHECER O MESMO CATALOGO ─────────────────────
 *
 * `backend-core` valida o que entra em `PATCH /users/me`, `game-server` valida
 * a intencao de equipar na mesa, e o `frontend` desenha. Os tres importam este
 * modulo, e os tres precisam registrar os itens autorais antes de julgar um id
 * — por isso o registro e MUTAVEL e global ao processo, e nao um parametro
 * passado de funcao em funcao: `ehSleeveValido` e chamado de dentro de um
 * `z.refine` sincrono, onde nao ha para onde passar contexto.
 *
 * A consequencia honesta: um processo que ainda nao sincronizou RECUSA um item
 * autoral recem-criado, com a mesma mensagem de id fora do catalogo. E o
 * comportamento certo para uma divergencia de cache (falha fechada, nunca
 * aberta), e some no proximo ciclo de sincronizacao.
 */

/** Um item autoral, na forma em que atravessa a rede. */
export interface CosmeticoAutoral {
  /** A familia determina em qual mapa ele entra. */
  familia: FamiliaDeCosmetico;
  /** O item em si — ja no formato final de `Sleeve`, `Playmat`, etc. */
  item: Sleeve | Playmat | ProfileBorder | ChatTitle | Pet;
}

const porId = <T extends { id: string }>(itens: readonly T[]) =>
  new Map(itens.map((i) => [i.id, i]));

/**
 * Os mapas sao MUTAVEIS e comecam com o catalogo de codigo.
 *
 * O catalogo de codigo e o piso: ele esta no bundle, funciona offline e nao
 * depende de banco nenhum. Se a sincronizacao falhar, o jogo continua com
 * exatamente o que tinha antes desta mudanca — que e a definicao de degradar
 * sem quebrar.
 */
const MAPA_SLEEVES = porId(SLEEVES);
const MAPA_PLAYMATS = porId(PLAYMATS);
const MAPA_BORDERS = porId(PROFILE_BORDERS);
const MAPA_TITLES = porId(CHAT_TITLES);
const MAPA_PETS = porId(PETS);

/** Ids de codigo, congelados: um item autoral nunca pode sobrescrever um deles. */
const IDS_DE_CODIGO: Record<FamiliaDeCosmetico, ReadonlySet<string>> = {
  sleeveId: new Set(SLEEVES.map((i) => i.id)),
  playmatId: new Set(PLAYMATS.map((i) => i.id)),
  borderId: new Set(PROFILE_BORDERS.map((i) => i.id)),
  titleId: new Set(CHAT_TITLES.map((i) => i.id)),
  petId: new Set(PETS.map((i) => i.id)),
};

const MAPAS: Record<FamiliaDeCosmetico, Map<string, { id: string }>> = {
  sleeveId: MAPA_SLEEVES as Map<string, { id: string }>,
  playmatId: MAPA_PLAYMATS as Map<string, { id: string }>,
  borderId: MAPA_BORDERS as Map<string, { id: string }>,
  titleId: MAPA_TITLES as Map<string, { id: string }>,
  petId: MAPA_PETS as Map<string, { id: string }>,
};

/** Ids autorais atualmente registrados, por familia — usado para limpar antes de recarregar. */
const AUTORAIS: Record<FamiliaDeCosmetico, Set<string>> = {
  sleeveId: new Set(),
  playmatId: new Set(),
  borderId: new Set(),
  titleId: new Set(),
  petId: new Set(),
};

/**
 * Substitui o conjunto autoral inteiro pelo que veio da sincronizacao.
 *
 * SUBSTITUI, nao acrescenta: um item desativado no backoffice precisa
 * DESAPARECER do catalogo, e um registro incremental so saberia adicionar. O
 * catalogo de codigo nunca e tocado — itens autorais que colidam com um id de
 * codigo sao descartados, senao o backoffice poderia redefinir o sleeve padrao
 * e mudar a aparencia de toda carta oculta do jogo.
 *
 * Devolve quantos entraram, para o chamador poder registrar no log.
 */
export function registrarCosmeticosAutorais(extras: readonly CosmeticoAutoral[]): number {
  for (const familia of Object.keys(AUTORAIS) as FamiliaDeCosmetico[]) {
    for (const id of AUTORAIS[familia]) MAPAS[familia].delete(id);
    AUTORAIS[familia].clear();
  }

  let aceitos = 0;
  for (const { familia, item } of extras) {
    if (!MAPAS[familia] || IDS_DE_CODIGO[familia]?.has(item.id)) continue;
    MAPAS[familia].set(item.id, item);
    AUTORAIS[familia].add(item.id);
    aceitos += 1;
  }
  return aceitos;
}

/**
 * As listas para quem ITERA o catalogo — seletor do jogador e painel do admin.
 *
 * `SLEEVES` e companhia continuam exportados e continuam sendo so o catalogo de
 * codigo. Quem precisa do catalogo COMPLETO usa estas funcoes; quem precisa
 * saber o que veio no bundle usa as constantes. A distincao importa no painel,
 * que mostra as duas origens em colunas separadas.
 */
export const listarSleeves = (): readonly Sleeve[] => [...MAPA_SLEEVES.values()];
export const listarPlaymats = (): readonly Playmat[] => [...MAPA_PLAYMATS.values()];
export const listarBorders = (): readonly ProfileBorder[] => [...MAPA_BORDERS.values()];
export const listarTitles = (): readonly ChatTitle[] => [...MAPA_TITLES.values()];
export const listarPets = (): readonly Pet[] => [...MAPA_PETS.values()];

/** O item e autoral (veio do backoffice) e nao do bundle? */
export const ehAutoral = (familia: FamiliaDeCosmetico, id: string): boolean =>
  AUTORAIS[familia].has(id);

// ─── Normalizacao do item autoral ────────────────────────────────────────────

/**
 * ─── O VOCABULARIO FECHADO, EM TEMPO DE EXECUCAO ───────────────────────────
 *
 * As unioes de literais (`padrao`, `forma`, `animacao`) desaparecem na
 * compilacao. Um item autoral chega por JSON — do banco, da rede — onde nao ha
 * tipo nenhum, e `padrao: "javascript:alert(1)"` atravessaria um cast alegre
 * ate o renderizador.
 *
 * Estas listas sao a mesma uniao, agora com existencia em runtime. Elas tem que
 * ficar EM PAR com as interfaces la de cima; um `satisfies` amarra as duas, e
 * acrescentar uma trama nova sem listar aqui para de compilar.
 */
const PADROES_DE_SLEEVE = ['losango', 'raios', 'ondas', 'grade', 'liso', 'circuito'] as const;
const PADROES_DE_PLAYMAT = ['nebulosa', 'hexagonos', 'linhas', 'liso', 'runas'] as const;
const FORMAS_DE_PET = ['dragao', 'coruja', 'gato', 'slime', 'fenix', 'nenhum'] as const;
const ANIMACOES_DE_PET = ['flutuar', 'pulsar', 'balancar'] as const;

export const VOCABULARIO_DE_COSMETICOS = {
  padraoDeSleeve: PADROES_DE_SLEEVE,
  padraoDePlaymat: PADROES_DE_PLAYMAT,
  formaDePet: FORMAS_DE_PET,
  animacaoDePet: ANIMACOES_DE_PET,
} as const;

/** Amarra as listas de runtime as interfaces. Acrescentar uma sem a outra nao compila. */
const _conferir = {
  s: PADROES_DE_SLEEVE satisfies readonly Sleeve['padrao'][],
  p: PADROES_DE_PLAYMAT satisfies readonly Playmat['padrao'][],
  f: FORMAS_DE_PET satisfies readonly Pet['forma'][],
  a: ANIMACOES_DE_PET satisfies readonly Pet['animacao'][],
};
void _conferir;

/**
 * Cor hexadecimal de 6 digitos, e so isso.
 *
 * Nao e frescura de formato: a cor vai direto para `fillStyle`, que aceita
 * praticamente qualquer string e falha em silencio no que nao entende — uma
 * cor invalida nao lanca, ela desenha preto. Aceitar so `#rrggbb` significa
 * que o que passa daqui desenha o que o admin viu na previa.
 */
const COR = /^#[0-9a-fA-F]{6}$/;

/** Slug do id: minusculas, digitos e hifen. O id vai para a URL do painel e para o estado da sala. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};
const cor = (v: unknown): string | null =>
  typeof v === 'string' && COR.test(v) ? v.toLowerCase() : null;
const umDe = <T extends string>(v: unknown, lista: readonly T[]): T | null =>
  typeof v === 'string' && (lista as readonly string[]).includes(v) ? (v as T) : null;

/** O que chega: qualquer coisa. Por isso todo campo e `unknown`. */
export type CosmeticoAutoralBruto = { [k: string]: unknown };

/**
 * O par de cores, aceito nas DUAS formas.
 *
 * ─── POR QUE ISTO PRECISA SER IDEMPOTENTE ──────────────────────────────────
 *
 * O formulario manda `cor1` e `cor2` — dois campos separados, porque sao dois
 * controles separados na tela. O que o servidor GRAVA e o item ja normalizado,
 * onde os dois viraram a tupla `cores` que o renderizador consome.
 *
 * Se esta funcao so entendesse a forma de entrada, normalizar de novo o que
 * saiu dela devolveria `null` — e foi exatamente o que aconteceu: o item era
 * criado com sucesso, gravado certo, e sumia na releitura. Sem erro em lugar
 * nenhum, porque `null` ali significa "linha invalida, pula".
 *
 * `normalizar(normalizar(x)) === normalizar(x)` e a propriedade que fecha essa
 * classe inteira de defeito, e e o mesmo contrato de `normalizarConfigDeSala`.
 */
function parDeCores(bruto: CosmeticoAutoralBruto): [string, string] | null {
  const tupla = bruto['cores'];
  /**
   * `cores` PRESENTE manda, mesmo que esteja quebrado.
   *
   * Cair de volta em `cor1`/`cor2` quando a tupla nao presta seria aceitar um
   * registro corrompido desenhando cores que ninguem escolheu — pior do que
   * recusar, porque o item apareceria certo na lista e errado na mesa. Aceitar
   * as duas formas nao pode virar uma porta que valida menos que cada uma.
   */
  if (tupla !== undefined) {
    if (!Array.isArray(tupla) || tupla.length !== 2) return null;
    const a = cor(tupla[0]);
    const b = cor(tupla[1]);
    return a && b ? [a, b] : null;
  }
  const a = cor(bruto['cor1']);
  const b = cor(bruto['cor2']);
  return a && b ? [a, b] : null;
}

/**
 * Converte um registro cru num item de catalogo, ou devolve `null`.
 *
 * `null` em vez de excecao porque os dois chamadores querem a mesma coisa:
 * PULAR a linha ruim e seguir com o resto. Uma linha corrompida no banco nao
 * pode derrubar a sincronizacao inteira e levar junto os itens que estavam
 * certos — nem no servidor, nem no cliente.
 */
export function normalizarCosmeticoAutoral(bruto: CosmeticoAutoralBruto): CosmeticoAutoral | null {
  const familia = umDe(bruto['familia'], [
    'sleeveId',
    'playmatId',
    'borderId',
    'titleId',
    'petId',
  ] as const);
  if (!familia) return null;

  const id = typeof bruto['id'] === 'string' && SLUG.test(bruto['id']) ? bruto['id'] : null;
  const nome = texto(bruto['nome'], 48);
  const tier = umDe(bruto['tier'], ['FREE', 'APOIADOR'] as const);
  if (!id || !nome || !tier) return null;

  switch (familia) {
    case 'sleeveId': {
      const cores = parDeCores(bruto);
      const borda = cor(bruto['borda']);
      const detalhe = cor(bruto['detalhe']);
      const padrao = umDe(bruto['padrao'], PADROES_DE_SLEEVE);
      if (!cores || !borda || !detalhe || !padrao) return null;
      return { familia, item: { id, nome, tier, cores, borda, detalhe, padrao } };
    }
    case 'playmatId': {
      const cores = parDeCores(bruto);
      const destaque = cor(bruto['destaque']);
      const padrao = umDe(bruto['padrao'], PADROES_DE_PLAYMAT);
      if (!cores || !destaque || !padrao) return null;
      return { familia, item: { id, nome, tier, cores, destaque, padrao } };
    }
    case 'borderId': {
      // A classe e um NOME DE CLASSE CSS que ja existe na folha de estilo, nao
      // CSS arbitrario: o admin escolhe entre as bordas que o cliente sabe
      // desenhar. Por isso o conjunto vem do proprio catalogo de codigo.
      const classe = umDe(
        bruto['classe'],
        PROFILE_BORDERS.map((b) => b.classe),
      );
      if (!classe) return null;
      return { familia, item: { id, nome, tier, classe } };
    }
    case 'titleId': {
      const badge = texto(bruto['badge'], 16);
      const c = cor(bruto['cor']);
      if (!badge || !c) return null;
      return { familia, item: { id, nome, tier, badge, cor: c } };
    }
    case 'petId': {
      const forma = umDe(bruto['forma'], FORMAS_DE_PET);
      const animacao = umDe(bruto['animacao'], ANIMACOES_DE_PET);
      const c = cor(bruto['cor']);
      if (!forma || !animacao || !c) return null;
      return { familia, item: { id, nome, tier, forma, cor: c, animacao } };
    }
  }
}

/** Normaliza uma lista, descartando em silencio o que nao passa. */
export function normalizarCosmeticosAutorais(
  brutos: readonly CosmeticoAutoralBruto[],
): CosmeticoAutoral[] {
  const bons: CosmeticoAutoral[] = [];
  for (const b of brutos) {
    const item = normalizarCosmeticoAutoral(b);
    if (item) bons.push(item);
  }
  return bons;
}

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
