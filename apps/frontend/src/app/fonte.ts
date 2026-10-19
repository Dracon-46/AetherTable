import { Inter } from 'next/font/google';

/**
 * A Inter é baixada no build e servida pelo próprio site. Com o `<link>` do
 * Google Fonts, cada visita mandava o IP do visitante ao Google (LGPD).
 *
 * O CSS chega à fonte pela variável `--font-inter` (via `--font-sans` no
 * `globals.css`), que traz junto a "Inter Fallback" de métricas ajustadas: o
 * texto não pula de tamanho quando a Inter termina de carregar. A variável
 * vai no `<html>` porque é ali (`:root`) que o `--font-sans` é resolvido.
 *
 * Mora num módulo próprio porque dois `<html>` a usam: o layout e a tela de
 * erro global, que substitui o layout quando ele mesmo falha.
 */
export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});
