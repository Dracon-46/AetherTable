/**
 * cabecalhos-de-seguranca.ts — os cabeçalhos HTTP de todas as páginas.
 *
 * Fica fora do `next.config.ts` para ser testável: a lista de origens da CSP é
 * montada a partir das variáveis de ambiente, e um erro ali só apareceria em
 * produção, como relatório de violação.
 *
 * ─── A CSP NASCE EM REPORT-ONLY ────────────────────────────────────────────
 *
 * Uma CSP aplicada que esquece uma origem quebra a página em silêncio: a mesa
 * abre, e a voz ou as imagens simplesmente não chegam. Em `Report-Only` o
 * navegador só relata o que bloquearia, e a política vira `Content-Security-
 * Policy` de verdade quando os relatórios estiverem limpos.
 */

import { httpDoWebSocket } from './api';

interface Cabecalho {
  key: string;
  value: string;
}

interface RegraDeCabecalhos {
  source: string;
  headers: Cabecalho[];
}

export interface OrigensDaPagina {
  /** `NEXT_PUBLIC_API_URL`, já com o padrão de `lib/api.ts`. */
  api: string;
  /** `NEXT_PUBLIC_GAME_WS_URL`, já com o padrão de `lib/api.ts`. */
  jogo: string;
  /** `NEXT_PUBLIC_LIVEKIT_URL`; vazio quando a voz está desligada. */
  voz: string;
}

/** Origem (`esquema://host:porta`) de uma URL; URL inválida vira `''`. */
export function origemDe(url: string): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * As duas portas de um servidor de WebSocket: o `ws(s)://` e o `http(s)://`
 * do mesmo host. O game server serve `/salas` pelo HTTP, e o LiveKit negocia
 * por HTTPS antes de abrir o WSS.
 */
function wsEHttp(url: string): string[] {
  const http = httpDoWebSocket(url);
  const ws = http.replace(/^http(s?):\/\//, 'ws$1://');
  return [origemDe(ws), origemDe(http)];
}

function lista(...fontes: string[]): string {
  return [...new Set(fontes.filter(Boolean))].join(' ');
}

export function montarCsp({ api, jogo, voz }: OrigensDaPagina): string {
  const origemDaApi = origemDe(api);
  return [
    "default-src 'self'",
    // O script de tema do `<head>` (ver `app/layout.tsx`) e o bootstrap do
    // Next são inline.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // A arte das cartas vem do proxy da API, e o sleeve é um canvas (`data:`).
    `img-src ${lista("'self'", 'data:', 'blob:', origemDaApi)}`,
    // O `next/font` serve a Inter do próprio site.
    "font-src 'self'",
    `connect-src ${lista("'self'", origemDaApi, ...wsEHttp(jogo), ...(voz ? wsEHttp(voz) : []))}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function cabecalhosDeSeguranca(
  origens: OrigensDaPagina,
  { producao }: { producao: boolean },
): RegraDeCabecalhos[] {
  const gerais: Cabecalho[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // O microfone é da voz da mesa; câmera e localização nada aqui usa.
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  ];
  // Em desenvolvimento o Next usa `eval` e WebSocket de recarga: a CSP só
  // geraria ruído no console.
  if (producao) {
    gerais.push({ key: 'Content-Security-Policy-Report-Only', value: montarCsp(origens) });
  }

  return [
    { source: '/(.*)', headers: gerais },
    // O token de redefinição de senha está na URL: nenhum `Referer` pode
    // levá-lo, nem para a própria origem. Vem DEPOIS da regra geral porque,
    // para a mesma chave, o Next fica com a última.
    { source: '/senha/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
  ];
}
