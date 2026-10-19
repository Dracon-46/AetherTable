/**
 * preferencias-de-interface.ts — como a pessoa quer VER o site, fora da mesa.
 *
 * ─── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * A visão da lista do grimório, o agrupamento, a ordenação, o tamanho das
 * artes, a densidade, as animações reduzidas e os dois idiomas viviam só no
 * `localStorage` (o `aparencia.store` do site). É o mesmo relato que trouxe
 * cosméticos, atalhos e as preferências de mesa para a conta: "se eu troco de
 * PC, zera". Quem escolheu a galeria agrupada por cor quer a galeria agrupada
 * por cor em qualquer máquina.
 *
 * O desenho é o de `preferencias.ts`, de propósito: um objeto JSONB, um padrão
 * de fábrica, a lista de chaves que o DTO usa para barrar abuso e um
 * normalizador que NUNCA falha — chamado pelas duas pontas, para não haver
 * duas ideias do que é um valor aceitável.
 *
 * ─── O QUE FICA DE FORA, E POR QUÊ ─────────────────────────────────────────
 *
 * `menuRecolhido` e `painelDeBuscaRecolhido` são do APARELHO, não da pessoa:
 * o menu recolhido que faz sentido num notebook de 1366 px atrapalha num
 * monitor largo, e o painel de busca é recolhido no celular por falta de
 * espaço. Levar isso de uma tela para outra desfaria a escolha que cada tela
 * pede. O tema também não entra: tem coluna própria (`theme`) desde a
 * primeira migração.
 */

import { CODIGOS_DE_IDIOMA, type IdiomaDeCarta } from './idiomas';

/** Como a lista de cartas do grimório é desenhada. */
export type VisaoDeDeck = 'lista' | 'galeria' | 'compacta';
export const VISOES_DE_DECK: readonly VisaoDeDeck[] = ['lista', 'galeria', 'compacta'];

/** Por qual critério as cartas são agrupadas. */
export type AgrupamentoDeDeck = 'tipo' | 'cor' | 'cmc' | 'raridade' | 'nenhum';
export const AGRUPAMENTOS_DE_DECK: readonly AgrupamentoDeDeck[] = [
  'tipo',
  'cor',
  'cmc',
  'raridade',
  'nenhum',
];

/** Em que ordem as cartas aparecem dentro de cada grupo. */
export type OrdenacaoDeDeck = 'nome' | 'cmc' | 'preco' | 'tipo' | 'raridade' | 'cor';
export const ORDENACOES_DE_DECK: readonly OrdenacaoDeDeck[] = [
  'nome',
  'cmc',
  'preco',
  'tipo',
  'raridade',
  'cor',
];

/** Tamanho das artes na galeria. Vira número de colunas na grade. */
export type TamanhoDeCarta = 'pequeno' | 'medio' | 'grande';
export const TAMANHOS_DE_CARTA: readonly TamanhoDeCarta[] = ['pequeno', 'medio', 'grande'];

/** Densidade da interface fora da mesa. */
export type Densidade = 'confortavel' | 'compacta';
export const DENSIDADES: readonly Densidade[] = ['confortavel', 'compacta'];

/**
 * Os idiomas em que a INTERFACE existe. O nome de cada um, para o seletor,
 * mora no site (`i18n/i18n.ts`), que confere em tempo de compilação que a
 * lista dele cabe nesta.
 */
export const IDIOMAS_ACEITOS_NA_INTERFACE = ['pt-BR', 'en'] as const;
export type CodigoDoIdiomaDaInterface = (typeof IDIOMAS_ACEITOS_NA_INTERFACE)[number];

export interface PreferenciasDeInterface {
  visaoDeDeck: VisaoDeDeck;
  agrupamentoDeDeck: AgrupamentoDeDeck;
  ordenacaoDeDeck: OrdenacaoDeDeck;
  tamanhoDeCarta: TamanhoDeCarta;
  densidade: Densidade;
  /** Preferir menos movimento, independente do sistema operacional. */
  animacoesReduzidas: boolean;
  /** Idioma preferido das CARTAS (código da Scryfall), não da interface. */
  idiomaDasCartas: IdiomaDeCarta;
  /** Idioma dos menus e das telas. */
  idiomaDaInterface: CodigoDoIdiomaDaInterface;
}

/**
 * O padrão de fábrica.
 *
 * É o mesmo estado inicial do `aparencia.store` do site — repetido aqui porque
 * este pacote não pode importar o cliente, e verificado por teste lá.
 */
export const PREFERENCIAS_DE_INTERFACE_PADRAO: Readonly<PreferenciasDeInterface> = {
  visaoDeDeck: 'lista',
  agrupamentoDeDeck: 'tipo',
  ordenacaoDeDeck: 'nome',
  tamanhoDeCarta: 'medio',
  densidade: 'confortavel',
  animacoesReduzidas: false,
  idiomaDasCartas: 'pt',
  idiomaDaInterface: 'pt-BR',
};

/** As chaves aceitas. Serve à validação e ao teto de tamanho do JSON. */
export const CHAVES_DE_PREFERENCIA_DE_INTERFACE = Object.keys(
  PREFERENCIAS_DE_INTERFACE_PADRAO,
) as (keyof PreferenciasDeInterface)[];

/** Um valor de uma lista fechada, ou o padrão. */
function daLista<T extends string>(valor: unknown, lista: readonly T[], padrao: T): T {
  return lista.includes(valor as T) ? (valor as T) : padrao;
}

/**
 * Transforma qualquer coisa vinda do banco (ou de uma versão antiga do
 * cliente) num objeto completo e dentro das listas.
 *
 * **Nunca falha e nunca devolve parcial**, pela mesma razão das preferências
 * de mesa: preferência é conforto, não autorização. Um campo estranho cai no
 * padrão e os outros passam — recusar o objeto inteiro faria a pessoa perder
 * sete escolhas por causa de uma.
 */
export function normalizarPreferenciasDeInterface(entrada: unknown): PreferenciasDeInterface {
  const p = PREFERENCIAS_DE_INTERFACE_PADRAO;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ...p };
  const e = entrada as Record<string, unknown>;

  return {
    visaoDeDeck: daLista(e.visaoDeDeck, VISOES_DE_DECK, p.visaoDeDeck),
    agrupamentoDeDeck: daLista(e.agrupamentoDeDeck, AGRUPAMENTOS_DE_DECK, p.agrupamentoDeDeck),
    ordenacaoDeDeck: daLista(e.ordenacaoDeDeck, ORDENACOES_DE_DECK, p.ordenacaoDeDeck),
    tamanhoDeCarta: daLista(e.tamanhoDeCarta, TAMANHOS_DE_CARTA, p.tamanhoDeCarta),
    densidade: daLista(e.densidade, DENSIDADES, p.densidade),
    animacoesReduzidas:
      typeof e.animacoesReduzidas === 'boolean' ? e.animacoesReduzidas : p.animacoesReduzidas,
    idiomaDasCartas: daLista(e.idiomaDasCartas, CODIGOS_DE_IDIOMA, p.idiomaDasCartas),
    idiomaDaInterface: daLista(
      e.idiomaDaInterface,
      IDIOMAS_ACEITOS_NA_INTERFACE,
      p.idiomaDaInterface,
    ),
  };
}

/** O maior texto que um valor desta preferência pode ter (`'confortavel'` tem 11). */
const MAIOR_VALOR = 32;

/**
 * O objeto tem forma gravável?
 *
 * A mesma regra de `ehPreferenciaDeMesa` — rígida quanto ao ABUSO (chave
 * desconhecida, objeto maior que o contrato), frouxa quanto ao valor, que o
 * normalizador conserta de qualquer jeito — com um degrau a mais: o VALOR de
 * cada chave tem de ser um escalar curto. Aqui toda preferência é um texto de
 * lista fechada ou um booleano, então um objeto aninhado ou um texto de 50 KB
 * numa chave válida só pode ser a coluna JSONB sendo usada como depósito.
 */
export function ehPreferenciaDeInterface(entrada: unknown): boolean {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return false;
  const pares = Object.entries(entrada);
  if (pares.length > CHAVES_DE_PREFERENCIA_DE_INTERFACE.length) return false;
  return pares.every(
    ([chave, valor]) =>
      (CHAVES_DE_PREFERENCIA_DE_INTERFACE as string[]).includes(chave) &&
      (typeof valor === 'boolean' || (typeof valor === 'string' && valor.length <= MAIOR_VALOR)),
  );
}
