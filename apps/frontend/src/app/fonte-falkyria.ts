import { Geist, Instrument_Serif } from 'next/font/google';

/**
 * As fontes do sistema visual da Falkyria (o mesmo do site e do painel do
 * Nicx): Geist no texto, Instrument Serif no título editorial.
 *
 * Moram num módulo separado de `fonte.ts` de propósito. O `next/font` pré-carrega
 * as fontes nas rotas cujo grafo de módulos as importa; se elas morassem junto
 * da Inter, que o layout raiz importa, a mesa de jogo baixaria duas famílias
 * que nunca desenha. Assim, só as telas de entrada pagam por elas.
 *
 * Como a Inter, são baixadas no build e servidas pelo próprio site (LGPD: o
 * `<link>` do Google Fonts mandaria o IP do visitante ao Google).
 */
export const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
});

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
});
