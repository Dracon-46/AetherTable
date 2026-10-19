import './polyfill';

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import type * as Playground from '@colyseus/playground';
import type { RedisPresence as TipoRedisPresence } from '@colyseus/redis-presence';
import type { RedisDriver as TipoRedisDriver } from '@colyseus/redis-driver';
import { AETHER_ROOM, REALTIME_LIMITS } from '@aethertable/shared-types';

import { config, isProd } from './config';
import { AetherRoom } from './rooms/AetherRoom';
import { registry } from './metrics';
import { iniciarSincronizacaoDoCatalogo } from './services/catalogo-de-cosmeticos';
import { limitarCorpoDoMatchmake, restringirMatchmaker, senhaDoBasic } from './borda-http';
import { Encoder } from '@colyseus/schema';

/**
 * ─── O BUFFER DE ENCODE E O TETO REAL DE JOGADORES POR MESA ─────────────────
 *
 * Isto era `100 * 1024` com o comentario "100KB for large EDH decks", e esse
 * numero era o limite de jogadores da plataforma sem que ninguem tivesse
 * decidido isso. `MAX_PLAYERS` dizia 8; a mesa quebrava por volta do sexto.
 *
 * O buffer e UM por sala, alocado uma vez, e nao cresce. O estado completo de
 * um assento com deck de cem cartas custa de 20 a 25 KB: cada `Card` leva UUID
 * de chave, UUID de `id` e quase trinta campos, e ainda entra a lista de
 * `zoneOrder` com cem UUIDs. Cinco assentos chegam a ~120 KB e ja raspam o
 * teto; seis passam.
 *
 * E o estouro nao falha alto — e isso que fazia o defeito chegar como "ela
 * parece estar na partida mas cai". No caminho com `view()` (e `Card.scryfallId`
 * e `view()`), o encoder que estourou aloca um buffer maior LOCAL, mas nao
 * guarda esse buffer de volta; a etapa seguinte volta a escrever no buffer
 * pequeno com um offset fora de faixa e o `subarray` corta em silencio. O
 * cliente que estava ENTRANDO recebe um ROOM_STATE truncado, o decoder dele
 * quebra e a conexao morre — enquanto o servidor ja o tinha sentado. Para o
 * resto da mesa ele fica no assento, porque a saida sem consentimento reserva
 * a cadeira pela janela de reconexao. Quem ja estava conectado nao percebe:
 * recebe patches, nao o estado inteiro.
 *
 * Por isso o tamanho agora SAI DE `MAX_PLAYERS`, e nao de uma constante solta:
 * subir o teto de assentos sem subir o buffer reintroduz exatamente este bug,
 * de novo em silencio. 64 KB por assento e ~2,5x o pior caso medido, e a folga
 * tambem cobre o caminho de patch — `reconciliarTudo` marca `scryfallId` de
 * TODAS as cartas como sujo, entao provisionar um deck na sala de espera emite
 * um patch do tamanho do conjunto inteiro.
 */
const BYTES_DE_ESTADO_POR_ASSENTO = 64 * 1024;
Encoder.BUFFER_SIZE = REALTIME_LIMITS.MAX_PLAYERS * BYTES_DE_ESTADO_POR_ASSENTO;

/**
 * Ponto de entrada do game server.
 *
 * AVISO RECORRENTE (DOC-022 §6): este processo NAO pode rodar em plataforma
 * serverless. WebSocket exige conexao persistente; cold start e limite de
 * duracao de execucao quebram a partida. VPS dedicada, sempre.
 */

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'game-server', ws: config.PUBLIC_WS_URL });
});

/**
 * ─── BASIC AUTH DAS SUPERFICIES DE OPERACAO ─────────────────────────────────
 *
 * `/colyseus` e `/metrics` estavam ABERTOS. O comentario do `/metrics` dizia
 * "rede interna, bloquear na borda" — o que no Render nao acontece — e o
 * monitor nao tinha nem comentario.
 *
 * O monitor e o mais grave dos dois: ele lista todas as salas, os clientes de
 * cada uma e permite inspecionar o estado, que inclui a mao e o grimorio de
 * todo mundo. E o unico caminho do sistema que contorna `podeVer` inteiro — as
 * sete clausulas de visibilidade governam o que o CLIENTE DE JOGO recebe, nao
 * o que o painel de operacao mostra.
 *
 * ─── POR QUE BASIC AUTH, E NAO O JWT DA CONTA ──────────────────────────────
 *
 * O game-server nao conhece contas. Ele valida seat tokens — que sao passes de
 * MESA, com `sub`, `roomId` e `jti` — e nao tem como saber se o `sub` de um
 * token e administrador: essa informacao vive no Postgres, do outro lado, e
 * consultar a API a cada request de painel acoplaria a operacao do game node a
 * disponibilidade da API. Basic auth com um segredo proprio mantem o painel
 * alcancavel exatamente quando ele mais importa: quando o resto esta fora do ar.
 *
 * `timingSafeEqual` em vez de `===`: comparacao de string sai no primeiro byte
 * diferente, e a diferenca de tempo entre "errou o primeiro caractere" e
 * "errou o ultimo" e mensuravel pela rede. Custa uma linha evitar isso.
 */
function autenticarOperacao(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  // Sem senha configurada: so em desenvolvimento, e o boot ja recusou subir
  // assim em producao (ver a checagem cruzada em config.ts).
  if (!config.ADMIN_PANEL_PASSWORD) return next();

  const senha = senhaDoBasic(req.headers.authorization);

  if (senha !== null) {
    const recebida = Buffer.from(senha);
    const esperada = Buffer.from(config.ADMIN_PANEL_PASSWORD);
    // `timingSafeEqual` exige o mesmo comprimento; o teste de tamanho antes
    // dele vaza so o comprimento da senha, que nao e segredo util.
    if (recebida.length === esperada.length && timingSafeEqual(recebida, esperada)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="AetherTable — operacao"');
  res.status(401).send('Autenticacao necessaria.');
}

/**
 * O monitor é uma página que mostra a mão de todo mundo: emoldurado num iframe
 * de outro site, um clique "inocente" do operador logado podia ser sequestrado
 * (clickjacking). Os dois cabeçalhos dizem a mesma coisa para navegadores de
 * gerações diferentes, e valem também para o 401 — por isso vêm antes da auth.
 */
app.use('/colyseus', (_req, res, next) => {
  res.set('X-Frame-Options', 'DENY');
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  next();
});
app.use('/colyseus', autenticarOperacao);
app.use('/metrics', autenticarOperacao);

app.get(
  '/metrics',
  assincrono(async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  }),
);

/**
 * Origens autorizadas a ler a vitrine do navegador.
 *
 * Lista explícita, e não `*`, pelo mesmo motivo do backend-core: um curinga
 * fecha a porta para qualquer evolução que precise de credencial, e abre a rota
 * para ser embutida em qualquer página. Aqui não há credencial nenhuma hoje —
 * é uma vitrine pública — mas o custo de ser explícito é uma variável de
 * ambiente que o deploy já configura para a outra ponta.
 */
/**
 * O site oficial entra SEMPRE, além do que `CORS_ORIGINS` disser. O servidor
 * de jogo de produção subiu sem essa variável apontando para a Vercel, e a
 * vitrine ficava vazia com erro de CORS — sem nada no log que dissesse por
 * quê. A origem oficial não é segredo nem configuração de ambiente: é o
 * produto.
 */
const ORIGEM_DO_SITE = 'https://aether-table-frontend.vercel.app';

const ORIGENS = new Set([
  ...config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  ORIGEM_DO_SITE,
]);

app.use('/salas', (req, res, next) => {
  const origem = req.headers.origin;
  // SEMPRE, e não só quando a origem é aceita: a resposta varia por origem dos
  // dois lados do `if`. Com o `Vary` só na resposta "com CORS", um cache no
  // caminho podia guardar a resposta SEM o cabeçalho (pedida por uma origem de
  // fora, ou sem `Origin`) e servi-la ao site oficial, que veria a vitrine
  // vazia com erro de CORS.
  res.set('Vary', 'Origin');
  if (origem && ORIGENS.has(origem)) {
    res.set('Access-Control-Allow-Origin', origem);
  }
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  // Sem preflight de verdade: um GET sem cabeçalho customizado é requisição
  // simples. O OPTIONS fica respondido de qualquer forma para o dia em que a
  // rota ganhar um filtro por cabeçalho.
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

/**
 * ─── LISTA DE SALAS PUBLICAS ─────────────────────────────────────────────────
 *
 * Le do matchMaker, nao do banco: nao existe modelo `Match` persistido e nao
 * vai existir (ADR-006, RN12 — o estado da sala vive na RAM do game node). O
 * que o `matchMaker.query` devolve sao os METADADOS que cada sala publicou em
 * `setMetadata`, e ele os consulta sem abrir sala nenhuma.
 *
 * ─── NUNCA DEVOLVER `metadata` CRU ──────────────────────────────────────────
 *
 * Esta rota e PUBLICA e o metadado e um objeto livre: no dia em que alguem
 * guardar ali um campo interno — um id de usuario, um contador de moderacao —
 * ele vaza para a internet sem que nada no codigo desta rota mude. Mapear campo
 * a campo faz o vazamento exigir uma edicao AQUI, que e onde a decisao de
 * publicar tem de ser tomada.
 *
 * A rota nao exige autenticacao de proposito: e uma vitrine, e o que ela mostra
 * de uma sala e o que o criador escolheu publicar ao marca-la como publica.
 * Entrar continua exigindo o `seatToken`, que so a API Core emite.
 */
app.get(
  '/salas',
  assincrono(async (_req, res) => {
    try {
      const salas = await matchMaker.query({ name: AETHER_ROOM });

      const publicas = salas
        .filter((sala) => {
          const meta = (sala.metadata ?? {}) as Record<string, unknown>;
          // `locked` cobre a sala que o Colyseus fechou por lotacao ou por
          // `lock()` explicito. Ela sai da lista de ENTRAR, mas nao some: vira
          // conteudo assistivel — e o que mantem a vitrine viva quando ha poucas
          // mesas abertas.
          return meta.visibilidade === 'PUBLICA';
        })
        .map((sala) => {
          const meta = sala.metadata as Record<string, unknown>;
          const ocupacao = Number(meta.ocupacao ?? sala.clients ?? 0);
          const maxSeats = Number(meta.maxSeats ?? sala.maxClients ?? 0);
          return {
            roomCode: texto(meta.roomCode, ''),
            nome: texto(meta.nome, ''),
            gameType: texto(meta.gameType, ''),
            comunicacao: texto(meta.comunicacao, 'QUALQUER'),
            idioma: texto(meta.idioma, 'pt-BR'),
            /** 0 = o anfitriao nao declarou. Nunca e calculado. */
            nivelDePoder: Number(meta.nivelDePoder ?? 0),
            ocupacao,
            maxSeats,
            emPartida: Boolean(meta.emPartida),
            /** Sala cheia OU trancada pelo Colyseus: da para assistir, nao entrar. */
            cheia: sala.locked === true || (maxSeats > 0 && ocupacao >= maxSeats),
          };
        })
        .filter((sala) => sala.roomCode.length > 0);

      res.json({ salas: publicas });
    } catch (erro) {
      // Uma vitrine que falha nao pode derrubar a Taverna: o painel trata lista
      // ausente como "nenhuma sala publica agora" e continua oferecendo criar e
      // entrar por codigo, que sao os dois caminhos que sempre funcionaram.
      console.error('[game-server] GET /salas falhou:', erro);
      res.status(503).json({ salas: [], erro: 'A lista de salas está indisponível.' });
    }
  }),
);

// Painel de inspecao de salas. A auth esta montada acima, em
// `autenticarOperacao` — e o boot recusa subir em producao sem a senha.
app.use('/colyseus', monitor());

// Playground: dispara intencoes a mao e inspeciona o estado sem passar pelo
// frontend. E a ferramenta mais util para desenvolver o motor.
if (!isProd) {
  // `require` tardio: o playground (e o @colyseus/auth que vem com ele) é
  // dependência de desenvolvimento e não entra na imagem de produção.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- carga condicional, só fora de produção
  const { playground } = require('@colyseus/playground') as typeof Playground;
  app.use('/playground', playground());
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Sem pong em 45 s, encerra. Heartbeat de 15 s (DOC-031 §2.2).
    pingInterval: 15_000,
    pingMaxRetries: 3,
    // Intencoes sao pequenas por natureza. Acima disto, so codigo malicioso.
    maxPayload: 4096,
  }),
  // Presence e driver do Redis: obrigatorios para escalar entre nos.
  // Ficam desligados em dev de um no para nao exigir Redis rodando.
  ...(config.USE_REDIS ? carregarRedis() : {}),
});

gameServer.define(AETHER_ROOM, AetherRoom).filterBy(['roomCode']);

/**
 * ─── O MATCHMAKER SÓ FAZ O QUE O FRONTEND USA ───────────────────────────────
 *
 * Depois do `new Server`: é ele que instala o desvio de `/matchmake` no
 * servidor HTTP, e o limite de corpo precisa embrulhar justamente esse desvio.
 * As origens são as MESMAS da vitrine (`CORS_ORIGINS` + o site oficial): a
 * vitrine e a entrada na mesa são chamadas pela mesma página, e uma lista
 * diferente para cada uma quebraria a entrada no deploy que esquecesse uma.
 * Ver `borda-http.ts`.
 */
restringirMatchmaker(ORIGENS, ORIGEM_DO_SITE);
limitarCorpoDoMatchmake(httpServer);

// Bind explícito em 0.0.0.0: hosts gerenciados (Render, Fly, Koyeb) fazem o
// health check de fora do container. Ligar só em localhost derruba o deploy.
gameServer
  .listen(config.PORT, '0.0.0.0')
  .then(() => {
    // Depois do listen, nao antes: o catalogo autoral e opcional para servir
    // partidas, e uma API Core lenta nao pode atrasar a subida do servidor de
    // jogo. Ate o primeiro ciclo terminar, vale o catalogo do bundle.
    iniciarSincronizacaoDoCatalogo();

    console.log(`[game-server] escutando em ws://localhost:${config.PORT}`);
    console.log(`[game-server] monitor:    http://localhost:${config.PORT}/colyseus`);
    if (!isProd) {
      console.log(`[game-server] playground: http://localhost:${config.PORT}/playground`);
    }
  })
  .catch((erro: unknown) => {
    // Porta ocupada, Redis fora do ar: o processo cai com código de erro, e o
    // host marca o deploy como quebrado em vez de manter um servidor surdo.
    console.error('[game-server] falha ao subir:', erro);
    process.exit(1);
  });

/**
 * Carrega presence/driver do Redis apenas quando pedido. O require e tardio de
 * proposito: em dev sem Redis, nem importar o modulo.
 */
function carregarRedis() {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { RedisPresence } = require('@colyseus/redis-presence') as {
    RedisPresence: typeof TipoRedisPresence;
  };
  const { RedisDriver } = require('@colyseus/redis-driver') as {
    RedisDriver: typeof TipoRedisDriver;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    presence: new RedisPresence(config.REDIS_URL),
    driver: new RedisDriver(config.REDIS_URL),
  };
}

// Encerramento gracioso: avisa as salas antes de cair, para o deploy nao
// derrubar partidas em andamento sem aviso.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    console.log(`[game-server] ${sinal} recebido, drenando salas...`);
    void gameServer.gracefullyShutdown().then(() => process.exit(0));
  });
}

/**
 * O Express 4 não espera promessa: a rejeição de um handler `async` vira
 * `unhandledRejection` e a requisição fica pendurada até o cliente desistir.
 * Este embrulho entrega a falha ao `next`, que responde 500.
 */
function assincrono(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): express.RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** Metadado de sala chega como `unknown`: só string passa; o resto vira o padrão. */
function texto(valor: unknown, padrao: string): string {
  return typeof valor === 'string' ? valor : padrao;
}
