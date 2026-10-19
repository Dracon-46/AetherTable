import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './Providers';

export const metadata: Metadata = {
  title: 'AetherTable - O Seu Novo Card Game',
  description: 'Jogue seus formatos favoritos de card games de forma online, imersiva e gratuita.',
};

/**
 * A Inter é baixada no build e servida pelo próprio site. Com o `<link>` do
 * Google Fonts, cada visita mandava o IP do visitante ao Google (LGPD).
 *
 * O nome da família que o `next/font` gera não é "Inter": quem precisa da
 * fonte lê a variável `--font-inter`, via `--font-sans` no `globals.css`. Ela
 * fica no `<html>` porque é ali (`:root`) que o `--font-sans` é resolvido.
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /**
     * `suppressHydrationWarning` no `<html>`: o script abaixo escreve
     * `data-tema` ANTES de o React hidratar, então o atributo que o servidor
     * renderizou e o que o navegador tem já são diferentes de propósito. Sem
     * isto, o React reclama de um descasamento que é justamente o objetivo.
     */
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        {/*
         * ─── O TEMA É APLICADO ANTES DA PRIMEIRA PINTURA ──────────────────
         *
         * Ler o tema num `useEffect` significa: o navegador pinta a tela
         * escura, o React monta, o efeito roda, a tela vira clara. Quem
         * escolheu claro veria um flash escuro a CADA carga de página — o
         * "flash of wrong theme", e ele é pior que não ter tema nenhum,
         * porque parece defeito.
         *
         * Um script síncrono no `<head>` roda antes de qualquer pintura. Ele é
         * a única coisa nesta base que justifica `dangerouslySetInnerHTML`: o
         * conteúdo é uma constante escrita aqui, não vem de lugar nenhum.
         *
         * Ele NÃO decide o tema — só aplica o que o `localStorage` já sabe. A
         * conta continua sendo a fonte da verdade, e corrige em seguida, em
         * `useHidratarPreferencias`.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var t = localStorage.getItem('aethertable:tema') || 'ESCURO';
              var claro = t === 'CLARO' || (t === 'SISTEMA' &&
                window.matchMedia('(prefers-color-scheme: light)').matches);
              document.documentElement.dataset.tema = claro ? 'claro' : 'escuro';
            }catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-table-deep text-text min-h-dvh w-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
