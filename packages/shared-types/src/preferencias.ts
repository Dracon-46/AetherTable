/**
 * preferencias.ts — as preferências de MESA que seguem a conta.
 *
 * ─── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * Tamanho da carta, alinhar à grade, custo de mana na mão, seguir o turno,
 * modo do painel de vida — tudo isso foi entregue guardado só em
 * `localStorage`. Funciona até a pessoa entrar de outra máquina, limpar dados
 * do site ou abrir uma janela anônima: aí a mesa volta ao padrão e a
 * preferência que ela ajustou some. Os cosméticos e os atalhos já tinham
 * passado por exatamente esse relato e já vivem em `user_preferences`; estas
 * ficaram para trás.
 *
 * Aqui está o contrato que faltava: o formato do que vai para a coluna, os
 * limites de cada campo e a função que sanitiza o que vier do banco.
 *
 * ─── UM OBJETO JSONB, E NÃO UMA COLUNA POR PREFERÊNCIA ─────────────────────
 *
 * Mesmo motivo de `keybindings`: este conjunto muda a cada versão da mesa e
 * NUNCA é filtrado em consulta. Uma coluna por preferência significaria uma
 * migração por caixinha nova de configuração — e são caixinhas que nascem
 * quase toda semana.
 *
 * ─── E POR QUE A SANITIZAÇÃO MORA AQUI, E NÃO NO CLIENTE ───────────────────
 *
 * JSONB aceita qualquer coisa: `fatorCarta: 900` deixaria a carta maior que a
 * tela, `vidaModo: "banana"` esconderia o painel de vida sem explicação. O
 * servidor valida na entrada (`AtualizarPerfilDto`) e o cliente sanitiza na
 * saída — as duas pontas chamando ESTA função, para não haver duas ideias do
 * que é um valor aceitável.
 */

/** Quanto da carta cabe na tela. Espelha `FATOR_CARTA_MIN/MAX` do canvas. */
export const FATOR_CARTA_MIN = 0.5;
export const FATOR_CARTA_MAX = 2;

/** Quanto do painel de vida fica na tela. */
export type ModoDoPainelDeVida = 'minima' | 'minha' | 'mesa';

export const MODOS_DO_PAINEL_DE_VIDA: readonly ModoDoPainelDeVida[] = ['minima', 'minha', 'mesa'];

/** Qual câmera a mesa abre. Só as duas visões ESTÁVEIS são persistíveis: */
export type VisaoDaMesa = 'ALL' | 'ME';

export const VISOES_DA_MESA: readonly VisaoDaMesa[] = ['ALL', 'ME'];

export interface PreferenciasDeMesa {
  /** Multiplicador do tamanho da carta (0,5 a 2,0). */
  fatorCarta: number;
  /** Encaixar a carta solta na grade de meia carta. */
  alinharNaGrade: boolean;
  /** Tirar "Anexar a…" do menu — quem não usa equipamento não quer o gesto. */
  anexosDesativados: boolean;
  /** Mostrar o custo de mana em cima da carta na mão. */
  custoDeManaNaMao: boolean;
  /** Levar a câmera para a mesa de quem está jogando. */
  seguirTurno: boolean;
  /** Desenhar o contorno das zonas no tabuleiro. */
  contornoDasZonas: boolean;
  /** Trilho de oponentes aberto. */
  trilhoAberto: boolean;
  /** Barra de ações da base aberta. */
  barraAberta: boolean;
  /** Log da partida aberto. */
  logAberto: boolean;
  vidaModo: ModoDoPainelDeVida;
  boardView: VisaoDaMesa;
}

/**
 * O padrão de fábrica.
 *
 * É o mesmo estado inicial do store da interface — repetido aqui porque este
 * pacote não pode importar o cliente, e verificado por teste dos dois lados.
 */
export const PREFERENCIAS_DE_MESA_PADRAO: Readonly<PreferenciasDeMesa> = {
  fatorCarta: 1,
  alinharNaGrade: false,
  anexosDesativados: false,
  custoDeManaNaMao: false,
  seguirTurno: false,
  contornoDasZonas: true,
  trilhoAberto: true,
  barraAberta: false,
  logAberto: false,
  vidaModo: 'minha',
  boardView: 'ALL',
};

/** As chaves aceitas. Serve à validação e ao teto de tamanho do JSON. */
export const CHAVES_DE_PREFERENCIA_DE_MESA = Object.keys(
  PREFERENCIAS_DE_MESA_PADRAO,
) as (keyof PreferenciasDeMesa)[];

function booleano(v: unknown, padrao: boolean): boolean {
  return typeof v === 'boolean' ? v : padrao;
}

/**
 * Transforma qualquer coisa vinda do banco (ou de uma versão antiga do
 * cliente) num objeto completo e dentro dos limites.
 *
 * **Nunca falha e nunca devolve parcial.** Preferência é conforto, não
 * autorização: recusar o objeto inteiro porque um campo veio estranho faria a
 * pessoa perder as outras dez preferências por causa de uma. Campo ausente ou
 * inválido cai no padrão, e o resto passa.
 *
 * `fatorCarta` é o único numérico e o único que precisa de trava real: um
 * valor fora da faixa deixa a carta ilegível ou maior que a tela. `NaN` cai no
 * padrão em vez de virar limite, porque `Math.min(2, NaN)` é `NaN`.
 */
export function normalizarPreferenciasDeMesa(entrada: unknown): PreferenciasDeMesa {
  const p = PREFERENCIAS_DE_MESA_PADRAO;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ...p };
  const e = entrada as Record<string, unknown>;

  const fator =
    typeof e.fatorCarta === 'number' && Number.isFinite(e.fatorCarta)
      ? Math.min(FATOR_CARTA_MAX, Math.max(FATOR_CARTA_MIN, e.fatorCarta))
      : p.fatorCarta;

  const vidaModo = MODOS_DO_PAINEL_DE_VIDA.includes(e.vidaModo as ModoDoPainelDeVida)
    ? (e.vidaModo as ModoDoPainelDeVida)
    : p.vidaModo;

  const boardView = VISOES_DA_MESA.includes(e.boardView as VisaoDaMesa)
    ? (e.boardView as VisaoDaMesa)
    : p.boardView;

  return {
    fatorCarta: fator,
    alinharNaGrade: booleano(e.alinharNaGrade, p.alinharNaGrade),
    anexosDesativados: booleano(e.anexosDesativados, p.anexosDesativados),
    custoDeManaNaMao: booleano(e.custoDeManaNaMao, p.custoDeManaNaMao),
    seguirTurno: booleano(e.seguirTurno, p.seguirTurno),
    contornoDasZonas: booleano(e.contornoDasZonas, p.contornoDasZonas),
    trilhoAberto: booleano(e.trilhoAberto, p.trilhoAberto),
    barraAberta: booleano(e.barraAberta, p.barraAberta),
    logAberto: booleano(e.logAberto, p.logAberto),
    vidaModo,
    boardView,
  };
}

/**
 * O objeto tem forma gravável?
 *
 * Rígido quanto ao ABUSO (chave desconhecida, objeto gigante), frouxo quanto
 * ao valor — que `normalizarPreferenciasDeMesa` conserta de qualquer jeito. O
 * que precisa ser barrado é a coluna JSONB virar armazenamento livre exposto
 * num PATCH autenticado.
 */
export function ehPreferenciaDeMesa(entrada: unknown): boolean {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return false;
  const chaves = Object.keys(entrada as Record<string, unknown>);
  if (chaves.length > CHAVES_DE_PREFERENCIA_DE_MESA.length) return false;
  return chaves.every((c) => (CHAVES_DE_PREFERENCIA_DE_MESA as string[]).includes(c));
}

// ─── TEMA DA INTERFACE ────────────────────────────────────────────────────────

/**
 * `UserPreference.theme` existe no Prisma desde a primeira migração, com um
 * enum de três valores, e nunca foi lido por ninguém — uma das quatro colunas
 * mortas do esquema. Estes são os mesmos três valores, agora com significado.
 *
 * `SISTEMA` acompanha o `prefers-color-scheme` do sistema operacional, e é
 * escolha legítima: quem configura o computador inteiro para claro à tarde e
 * escuro à noite não quer configurar cada site de novo.
 */
export const TEMAS = ['ESCURO', 'CLARO', 'SISTEMA'] as const;
export type Tema = (typeof TEMAS)[number];

export const TEMA_PADRAO: Tema = 'ESCURO';

/** Rótulo e explicação, para o seletor não ser três palavras soltas. */
export const DESCRICAO_DO_TEMA: Readonly<Record<Tema, { nome: string; resumo: string }>> = {
  ESCURO: {
    nome: 'Escuro',
    resumo: 'O padrão. Menos brilho em sessão longa e à noite.',
  },
  CLARO: {
    nome: 'Claro',
    resumo: 'Melhor sob luz forte e em tela de brilho baixo.',
  },
  SISTEMA: {
    nome: 'Do sistema',
    resumo: 'Acompanha a configuração do seu computador, e muda junto com ela.',
  },
};

/**
 * O enum do Prisma usa inglês (`DARK`/`LIGHT`/`SYSTEM`) porque nasceu assim na
 * primeira migração, e migrar um enum do Postgres para renomear três valores
 * custa mais do que estas duas funções valem.
 *
 * O resto do domínio é em português (ver `VISIBILIDADES`, `TIPOS_DE_MULLIGAN`),
 * e a fronteira de tradução fica aqui — num lugar só, e não espalhada por cada
 * chamador.
 */
const DO_PRISMA: Readonly<Record<string, Tema>> = {
  DARK: 'ESCURO',
  LIGHT: 'CLARO',
  SYSTEM: 'SISTEMA',
};
const PARA_PRISMA: Readonly<Record<Tema, string>> = {
  ESCURO: 'DARK',
  CLARO: 'LIGHT',
  SISTEMA: 'SYSTEM',
};

/** Um valor desconhecido cai no padrão, nunca lança. */
export function temaDoPrisma(valor: unknown): Tema {
  return DO_PRISMA[String(valor)] ?? TEMA_PADRAO;
}

export function temaParaPrisma(tema: Tema): string {
  return PARA_PRISMA[tema] ?? 'DARK';
}

export function ehTema(valor: unknown): valor is Tema {
  return TEMAS.includes(valor as Tema);
}
