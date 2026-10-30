/**
 * manifest.ts — o manifesto do aplicativo web.
 *
 * Sem ele, "adicionar à tela inicial" no celular gerava um atalho com a captura
 * da página e o nome tirado do `<title>` inteiro. Os ícones são os mesmos de
 * `app/icon.svg`, rasterizados: o manifesto não garante suporte a SVG em todo
 * navegador.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AetherTable',
    short_name: 'AetherTable',
    description: 'Mesa virtual sandbox para card games. Um produto Falkyria.',
    lang: 'pt-BR',
    start_url: '/',
    display: 'standalone',
    background_color: '#12141a',
    theme_color: '#12141a',
    icons: [
      { src: '/icones/aethertable-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icones/aethertable-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
