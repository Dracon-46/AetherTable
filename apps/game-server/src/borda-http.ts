/**
 * borda-http.ts — o que o processo HTTP do game-server aceita ANTES de a
 * requisição chegar ao Colyseus ou ao Express.
 *
 * Fica fora de `index.ts` porque aquele arquivo sobe o servidor na importação:
 * nada nele dá para testar sem abrir uma porta de verdade. Aqui são funções
 * puras e um embrulho de `http.Server`, que o teste exercita com servidores
 * efêmeros.
 */

import type http from 'node:http';
import { matchMaker } from '@colyseus/core';

/**
 * ─── O MATCHMAKER É A PORTA DE ENTRADA, E ESTAVA ESCANCARADA ────────────────
 *
 * `POST /matchmake/{create,join,joinOrCreate,joinById,reconnect}` vinha todo
 * exposto. O frontend usa DOIS: `joinOrCreate` (entrar pelo passe) e
 * `reconnect` (o F5 que volta ao assento — `net/reconexao.ts`). Os outros três
 * só serviam a quem não usa o nosso cliente: `join {}` devolvia a listagem de
 * uma sala qualquer — com o `roomCode` de mesa PRIVADA —, e `create` abria
 * salas sem passe nenhum.
 */
export const METODOS_DO_MATCHMAKER = ['joinOrCreate', 'reconnect'] as const;

/** Teto do corpo de um POST de matchmake. O legítimo tem algumas centenas de bytes. */
export const LIMITE_DO_CORPO_DO_MATCHMAKE = 8 * 1024;

/**
 * O MESMO critério que o Colyseus usa para desviar a requisição ao matchmaker
 * (`attachMatchMakingRoutes`: `url.indexOf('/matchmake') !== -1`). Um critério
 * mais estrito aqui deixaria passar sem limite justamente o que o Colyseus
 * trata como matchmake.
 */
export function ehRequisicaoDeMatchmake(url: string | undefined): boolean {
  return (url ?? '').includes(`/${matchMaker.controller.matchmakeRoute}`);
}

/**
 * Cabeçalhos CORS do matchmaker para uma origem.
 *
 * O padrão do Colyseus REFLETE qualquer `Origin` (com
 * `Access-Control-Allow-Credentials: true` nos padrões dele): qualquer página
 * da internet podia dirigir o matchmaker a partir do navegador de quem a
 * visitasse. Agora só as origens da plataforma são refletidas.
 *
 * Origem desconhecida recebe o SITE OFICIAL no `Allow-Origin`, e não a ausência
 * do cabeçalho: o Colyseus funde estes cabeçalhos por cima dos padrões dele, e
 * o padrão é `*`. Omitir a chave deixaria o curinga valer. `'null'` também não
 * serve — é a origem de iframe em sandbox e de `file://`, e casaria com eles.
 */
export function cabecalhosCorsDoMatchmaker(
  origem: string | undefined,
  permitidas: ReadonlySet<string>,
  oficial: string,
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origem && permitidas.has(origem) ? origem : oficial,
    // A resposta muda com a origem: sem isto um cache no caminho serviria a
    // resposta de uma origem para outra.
    Vary: 'Origin',
  };
}

/** Restringe métodos e CORS do matchmaker. Chamar UMA vez, na subida. */
export function restringirMatchmaker(permitidas: ReadonlySet<string>, oficial: string): void {
  // A API pública da 0.16 é este objeto: `invokeMethod` recusa com
  // MATCHMAKE_NO_HANDLER o que não estiver na lista, e `getCorsHeaders` é o
  // gancho documentado para trocar os cabeçalhos.
  matchMaker.controller.exposedMethods = [...METODOS_DO_MATCHMAKER];
  matchMaker.controller.getCorsHeaders = (req: http.IncomingMessage) =>
    cabecalhosCorsDoMatchmaker(req.headers.origin, permitidas, oficial);
}

/**
 * ─── O CORPO DO MATCHMAKE ERA LIDO SEM LIMITE ───────────────────────────────
 *
 * `handleMatchMakeRequest` empilha cada pedaço do corpo num array até o `end`,
 * e só então faz `JSON.parse` — sem teto. Um POST de centenas de megabytes
 * enchia a memória do processo que hospeda TODAS as mesas do nó.
 *
 * O `maxPayload` do WebSocket não cobre isto (é outro canal), e o Colyseus não
 * tem opção para limitar. Então o limite entra por fora: este embrulho troca os
 * ouvintes de `request` do servidor HTTP — que, depois de `new Server(...)`, são
 * o desvio do próprio Colyseus — por um que mede o corpo das requisições de
 * matchmake ANTES de entregá-las.
 *
 *   - `Content-Length` declarado acima do teto: recusa sem ler nada;
 *   - corpo em pedaços (sem `Content-Length`, ou mentindo): conta byte a byte e
 *     derruba a requisição no pedaço que passar do teto. O Colyseus nunca vê o
 *     `end`, então nunca responde nem faz `JSON.parse` do lixo.
 *
 * O resto do servidor HTTP (`/salas`, `/health`, o monitor) segue intocado.
 */
export function limitarCorpoDoMatchmake(
  servidor: http.Server,
  limite: number = LIMITE_DO_CORPO_DO_MATCHMAKE,
): void {
  const originais = servidor.listeners('request') as http.RequestListener[];
  servidor.removeAllListeners('request');

  servidor.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'POST' && ehRequisicaoDeMatchmake(req.url)) {
      const declarado = Number(req.headers['content-length'] ?? 0);
      if (declarado > limite) {
        recusarCorpo(req, res);
        return;
      }
      let recebidos = 0;
      req.on('data', (pedaco: Buffer) => {
        recebidos += pedaco.length;
        if (recebidos > limite) recusarCorpo(req, res);
      });
    }
    for (const ouvinte of originais) ouvinte.call(servidor, req, res);
  });
}

function recusarCorpo(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Tira o acumulador do Colyseus (e o `end` dele) do caminho: o que já foi
  // empilhado é no máximo o teto mais um pedaço, e vai embora com a requisição.
  req.removeAllListeners('data');
  req.removeAllListeners('end');
  req.pause();
  if (res.headersSent) {
    req.destroy();
    return;
  }
  res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
  // Destrói DEPOIS de a resposta sair: destruir antes cortaria o 413, e o
  // cliente legítimo (que nunca chega aqui) veria um "connection reset" mudo.
  res.end(JSON.stringify({ code: 413, error: 'payload too large' }), () => req.destroy());
}

/**
 * Senha de um cabeçalho `Authorization: Basic ...`, ou `null`.
 *
 * O separador é o PRIMEIRO `:` (RFC 7617): o usuário não pode conter `:`, a
 * senha pode. O `split(':')` anterior pegava só o pedaço entre o primeiro e o
 * segundo `:` — uma senha com `:` nunca conferia, e quem a escolheu ficava
 * trancado fora do próprio painel.
 */
export function senhaDoBasic(cabecalho: string | undefined): string | null {
  const [tipo, credencial] = (cabecalho ?? '').split(' ');
  if (tipo !== 'Basic' || !credencial) return null;
  const decodificada = Buffer.from(credencial, 'base64').toString('utf8');
  const separador = decodificada.indexOf(':');
  if (separador === -1) return null;
  return decodificada.slice(separador + 1);
}
