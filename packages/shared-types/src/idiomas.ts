/**
 * idiomas.ts — os idiomas em que uma carta pode ser impressa.
 *
 * Os códigos são os da Scryfall (`lang:`), e não os da interface: português de
 * carta é `pt`, e não `pt-BR`. A lista é fechada porque vira um `lang:` dentro
 * de uma busca — texto livre ali seria sintaxe de busca vinda do cliente.
 */

export const IDIOMAS_DE_CARTA = [
  { codigo: 'en', nome: 'Inglês' },
  { codigo: 'pt', nome: 'Português' },
  { codigo: 'es', nome: 'Espanhol' },
  { codigo: 'fr', nome: 'Francês' },
  { codigo: 'de', nome: 'Alemão' },
  { codigo: 'it', nome: 'Italiano' },
  { codigo: 'ja', nome: 'Japonês' },
] as const;

export type IdiomaDeCarta = (typeof IDIOMAS_DE_CARTA)[number]['codigo'];

export const CODIGOS_DE_IDIOMA = IDIOMAS_DE_CARTA.map((i) => i.codigo) as [
  IdiomaDeCarta,
  ...IdiomaDeCarta[],
];

export function nomeDoIdioma(codigo: string): string {
  return IDIOMAS_DE_CARTA.find((i) => i.codigo === codigo)?.nome ?? codigo;
}
