import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Pacotes do workspace consumidos como TS-fonte precisam ser transpilados.
  transpilePackages: ['@aethertable/ui', '@aethertable/shared-types'],
  images: {
    // Nunca hospedamos artes de carta: as imagens vem da CDN da Scryfall.
    remotePatterns: [{ protocol: 'https', hostname: 'cards.scryfall.io' }],
  },

  webpack: (config) => {
    // O Konva publica um build para Node (`konva/lib/index-node.js`) que faz
    // `require('canvas')` — o binding nativo usado para rasterizar fora do
    // browser. Não temos esse pacote e não queremos: a mesa é 100 % CSR
    // (docs/stack_tecnologico.md §2.1), o Canvas nunca renderiza no servidor.
    //
    // O `dynamic(..., { ssr: false })` da rota resolve o RUNTIME, mas não o
    // BUILD: o webpack ainda percorre o grafo de módulos e tenta resolver o
    // require. Marcar como `false` corta o ramo na resolução.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default config;
