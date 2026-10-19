import type { NextConfig } from 'next';
import { API_URL, LIVEKIT_URL, WS_URL } from './src/lib/api';
import { cabecalhosDeSeguranca } from './src/lib/cabecalhos-de-seguranca';

const config: NextConfig = {
  reactStrictMode: true,
  // `X-Powered-By: Next.js` só diz a quem procura falha conhecida o que testar.
  poweredByHeader: false,
  /**
   * As origens saem das MESMAS constantes que o cliente usa (`lib/api.ts`),
   * com os mesmos padrões: uma CSP que liberasse outro endereço que não o que a
   * página de fato chama seria um relatório falso de cada lado.
   */
  headers: () =>
    Promise.resolve(
      cabecalhosDeSeguranca(
        { api: API_URL, jogo: WS_URL, voz: LIVEKIT_URL },
        { producao: process.env.NODE_ENV === 'production' },
      ),
    ),
  // Pacotes do workspace consumidos como TS-fonte precisam ser transpilados.
  transpilePackages: ['@aethertable/shared-types'],
  images: {
    // Continuamos sem HOSPEDAR arte de carta: o backend só reencaminha o que a
    // CDN da Scryfall serve (`GET /api/v1/cards/img/:id`), porque o navegador do
    // usuário pode não alcançar `cards.scryfall.io` numa rede filtrada.
    // O padrão abaixo fica para qualquer uso residual de `next/image` apontando
    // direto para a CDN.
    remotePatterns: [{ protocol: 'https', hostname: 'cards.scryfall.io' }],
  },

  // O Next tipa este parâmetro como `any`. Só o pedaço que tocamos é declarado.
  webpack: (config: ConfigDoWebpack) => {
    // O Konva publica um build para Node (`konva/lib/index-node.js`) que faz
    // `require('canvas')` — o binding nativo usado para rasterizar fora do
    // browser. Não temos esse pacote e não queremos: a mesa é 100 % CSR
    // (docs/stack_tecnologico.md §2.1), o Canvas nunca renderiza no servidor.
    //
    // O `dynamic(..., { ssr: false })` da rota resolve o RUNTIME, mas não o
    // BUILD: o webpack ainda percorre o grafo de módulos e tenta resolver o
    // require. Marcar como `false` corta o ramo na resolução.
    config.resolve ??= {};
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

interface ConfigDoWebpack {
  resolve?: { alias?: Record<string, string | false | string[]> };
}

export default config;
