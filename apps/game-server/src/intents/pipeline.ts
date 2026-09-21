/**
 * pipeline.ts — a corrente que uma intencao atravessa antes de virar mutacao
 * (padrao CHAIN OF RESPONSIBILITY, GoF).
 *
 * ─── O QUE HAVIA AQUI ANTES ─────────────────────────────────────────────────
 *
 * Uma funcao de 110 linhas dentro de `AetherRoom.registrarIntencoes`, criada
 * uma vez por intencao registrada (sao 96), com seis barreiras em sequencia
 * escritas como `if` aninhado: limite de intencoes, limite de sorteios,
 * barreira de espectador, validacao do payload, autorizacao e execucao.
 *
 * Tres problemas concretos, e nenhum deles e estetico:
 *
 * 1. A ORDEM ERA IMPLICITA E IMPORTA. A barreira de espectador PRECISA vir
 *    antes do parse do payload — nao faz sentido validar o corpo de uma acao
 *    que o remetente nao pode praticar — e o unico registro disso era um
 *    comentario de 20 linhas pedindo para ninguem mover o bloco.
 * 2. NAO DAVA PARA TESTAR UMA BARREIRA SOZINHA. Para exercitar o limite de
 *    sorteios era preciso subir uma Room do Colyseus inteira; o resultado e
 *    que nenhuma das seis tinha teste proprio.
 * 3. A SETIMA BARREIRA SERIA ESCRITA NO MEIO. Toda regra nova (moderacao,
 *    pausa da mesa, mesa so para convidados) entrava como mais um `if` na
 *    mesma funcao, e nao havia nenhum lugar obvio para ela ir.
 *
 * ─── O QUE A CORRENTE MUDA ──────────────────────────────────────────────────
 *
 * Cada barreira vira um elo com um nome, um teste proprio, e uma unica decisao:
 * recusar (e responder ao cliente) ou passar adiante. A ordem passa a ser
 * DADO — a lista em `montarCorrente` — em vez de aninhamento. O ultimo elo e o
 * unico que muta estado, e ele so recebe pedidos que sobreviveram a todos os
 * outros.
 *
 * O `Pedido` e mutavel de proposito: `ValidacaoDePayload` escreve `dados` (o
 * payload ja parseado por zod) e os elos seguintes leem dali. E o "request
 * object" classico do padrao — sem ele, o parse teria de rodar duas vezes.
 */

import type { Client } from '@colyseus/core';
import type { z } from 'zod';

import type { RoomState } from '../schema/RoomState';
import {
  espectadorBarrado,
  verificarAutorizacao,
  type IntentContext,
  type IntentHandler,
  type RateLimiter,
} from './registry';

/** O que anda pela corrente. `dados` so existe depois do elo de validacao. */
export interface Pedido {
  readonly tipo: string;
  readonly client: Client;
  readonly payload: unknown;
  readonly handler: IntentHandler<z.ZodTypeAny>;
  dados?: unknown;
}

/**
 * Para onde o resultado do despacho e contado.
 *
 * E uma interface (e nao um `import` do prom-client) porque a corrente e
 * testada sem servidor: o teste passa um observador que so anota, e a Room
 * passa o que incrementa as metricas de verdade.
 */
export interface ObservadorDeDespacho {
  aceita(tipo: string): void;
  recusada(motivo: string): void;
  falhou(tipo: string, erro: unknown): void;
}

/**
 * O que o ultimo elo precisa da sala — e nada alem disso.
 *
 * Existe para que `ExecucaoDoHandler` nao conheca `AetherRoom`: o elo sabe
 * pedir um contexto e avisar antes e depois da mutacao; o que a sala faz com
 * esses dois avisos (snapshot de undo, reaplicar topo revelado, publicar
 * metadados quando a fase muda) e problema dela.
 */
export interface SalaDoDespacho {
  readonly state: RoomState;
  contextoPara(client: Client): IntentContext;
  antesDaMutacao(client: Client, tipo: string): void;
  depoisDaMutacao(ctx: IntentContext, tipo: string): void;
}

/** Um elo. Recusa, ou passa adiante. */
export abstract class EloDoDespacho {
  private seguinte: EloDoDespacho | null = null;

  /** Liga o proximo elo e devolve ELE, para encadear em sequencia. */
  seguidoPor(elo: EloDoDespacho): EloDoDespacho {
    this.seguinte = elo;
    return elo;
  }

  abstract tratar(pedido: Pedido): void;

  /**
   * Passa adiante. O ultimo elo nao tem seguinte — e por isso a corrente nao
   * "cai no vazio": quem chega ao fim ja foi executado.
   */
  protected passar(pedido: Pedido): void {
    this.seguinte?.tratar(pedido);
  }
}

// ─── Elos ────────────────────────────────────────────────────────────────────

/**
 * 30 intencoes por segundo, por cliente (NFR-04). Primeiro elo de proposito:
 * e o mais barato de todos, e recusar cedo e o que protege os outros cinco.
 */
export class LimiteDeIntencoes extends EloDoDespacho {
  constructor(
    private readonly limitador: RateLimiter,
    private readonly observador: ObservadorDeDespacho,
  ) {
    super();
  }

  override tratar(pedido: Pedido): void {
    if (!this.limitador.permitir(pedido.client.sessionId)) {
      this.observador.recusada('rate_limit');
      pedido.client.send('warning', {
        code: 'RATE_LIMITED',
        message: 'Muitas ações por segundo. Algumas foram descartadas.',
      });
      return;
    }
    this.passar(pedido);
  }
}

/**
 * Teto proprio para sorteio. Dado e moeda passam de sobra no limite geral —
 * cada rolagem e uma intencao valida — mas cada uma custa um broadcast e uma
 * linha de log em TODOS os clientes da mesa.
 */
export class LimiteDeSorteios extends EloDoDespacho {
  constructor(
    private readonly alvos: ReadonlySet<string>,
    private readonly limitador: RateLimiter,
    private readonly mensagem: string,
    private readonly observador: ObservadorDeDespacho,
  ) {
    super();
  }

  override tratar(pedido: Pedido): void {
    if (this.alvos.has(pedido.tipo) && !this.limitador.permitir(pedido.client.sessionId)) {
      this.observador.recusada('too_many_rolls');
      pedido.client.send('warning', { code: 'RATE_LIMITED', message: this.mensagem });
      return;
    }
    this.passar(pedido);
  }
}

/**
 * ─── ESPECTADOR NAO MEXE NA MESA ────────────────────────────────────────────
 *
 * `verificarAutorizacao` NAO cobre isto: ela devolve `null` na hora para
 * `QUALQUER_JOGADOR`, sem checar se o remetente e mesmo um jogador — o nome da
 * regra sempre foi uma promessa que ninguem verificava, porque ate o modo
 * espectador existir todo mundo na sala tinha assento.
 *
 * A barreira e um elo, e nao uma checagem dentro de cada handler, pelo mesmo
 * motivo de `exigirAnfitriao` existir: a proxima intencao nasce protegida em
 * vez de nascer aberta. Espalhar por 96 handlers e como garantir que os 96
 * lembrem — e os que esquecessem falhariam em SILENCIO, porque quase todos
 * comecam com um `state.players.get(sid)` que devolve `undefined` e sai calado.
 *
 * ELE VEM ANTES DA VALIDACAO DO PAYLOAD, e essa ordem e a razao de a corrente
 * existir: nao faz sentido validar o corpo de uma acao que o remetente nao pode
 * praticar. Antes isso era um comentario pedindo para nao mover o bloco; agora
 * e a posicao dele na lista de `montarCorrente`.
 */
export class BarreiraDeEspectador extends EloDoDespacho {
  constructor(
    private readonly sala: SalaDoDespacho,
    private readonly observador: ObservadorDeDespacho,
  ) {
    super();
  }

  override tratar(pedido: Pedido): void {
    if (espectadorBarrado(this.sala.state, pedido.client.sessionId, pedido.tipo)) {
      this.observador.recusada('spectator');
      pedido.client.send('error', {
        code: 'SPECTATOR',
        message: 'Você está assistindo a esta mesa. Só quem tem assento pode agir nela.',
        intent: pedido.tipo,
      });
      return;
    }
    this.passar(pedido);
  }
}

/** Zod (FR-11). O elo escreve `pedido.dados` para quem vem depois. */
export class ValidacaoDePayload extends EloDoDespacho {
  constructor(private readonly observador: ObservadorDeDespacho) {
    super();
  }

  override tratar(pedido: Pedido): void {
    const parsed = pedido.handler.schema.safeParse(pedido.payload);
    if (!parsed.success) {
      this.observador.recusada('invalid_payload');
      // Nunca inclui nome de carta na mensagem de erro (DOC-031 §5.4).
      pedido.client.send('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Ação rejeitada: o formato do pedido é inválido.',
        intent: pedido.tipo,
      });
      return;
    }
    pedido.dados = parsed.data;
    this.passar(pedido);
  }
}

/** Quem pode enviar (DOC-031 §3.0.1). Depende de `dados` ja parseado. */
export class Autorizacao extends EloDoDespacho {
  constructor(
    private readonly sala: SalaDoDespacho,
    private readonly observador: ObservadorDeDespacho,
  ) {
    super();
  }

  override tratar(pedido: Pedido): void {
    const negado = verificarAutorizacao(
      pedido.handler,
      this.sala.state,
      pedido.client.sessionId,
      pedido.dados,
    );
    if (negado) {
      this.observador.recusada(negado.toLowerCase());
      pedido.client.send('error', {
        code: negado,
        message: 'Ação não permitida.',
        intent: pedido.tipo,
      });
      return;
    }
    this.passar(pedido);
  }
}

/**
 * O fim da corrente: o unico ponto do sistema em que uma mensagem vira mutacao.
 *
 * Ele nao passa adiante — e nao ter seguinte e o que torna a invariante
 * verificavel de fora: se este elo nao rodou, nada mudou no estado.
 */
export class ExecucaoDoHandler extends EloDoDespacho {
  constructor(
    private readonly sala: SalaDoDespacho,
    private readonly observador: ObservadorDeDespacho,
  ) {
    super();
  }

  override tratar(pedido: Pedido): void {
    try {
      // O snapshot sai ANTES da mutacao e so para intencoes reversiveis — a
      // lista de exclusoes vive em services/undo.ts.
      this.sala.antesDaMutacao(pedido.client, pedido.tipo);

      const ctx = this.sala.contextoPara(pedido.client);
      pedido.handler.executa(ctx, pedido.dados);

      // Efeitos que valem para TODA intencao (topo revelado, fase publicada).
      this.sala.depoisDaMutacao(ctx, pedido.tipo);

      this.observador.aceita(pedido.tipo);
    } catch (erro) {
      // Uma intencao malformada NUNCA deve derrubar a sala dos outros tres
      // jogadores. O observador loga com o roomId; o cliente recebe generico.
      this.observador.falhou(pedido.tipo, erro);
      pedido.client.send('error', {
        code: 'INTERNAL',
        message: 'Erro interno na mesa. A ação não foi aplicada.',
        intent: pedido.tipo,
      });
    }
  }
}

// ─── Montagem ────────────────────────────────────────────────────────────────

/**
 * Liga os elos e devolve o primeiro.
 *
 * A LISTA E A ORDEM. Mudar a politica de despacho passa a ser mudar esta lista
 * — inclusive para inserir um elo novo no meio, que era exatamente a operacao
 * que antes exigia achar o `if` certo dentro de 110 linhas.
 */
export function montarCorrente(elos: readonly EloDoDespacho[]): EloDoDespacho {
  const primeiro = elos[0];
  if (!primeiro) throw new Error('corrente de despacho vazia');
  elos.reduce((anterior, atual) => anterior.seguidoPor(atual));
  return primeiro;
}

/** A corrente padrao da mesa, na ordem em que as barreiras valem. */
export function correnteDaMesa(entrada: {
  sala: SalaDoDespacho;
  observador: ObservadorDeDespacho;
  limitePadrao: RateLimiter;
  limiteDeSorteio: RateLimiter;
  intencoesDeSorteio: ReadonlySet<string>;
  mensagemDeSorteio: string;
}): EloDoDespacho {
  const { sala, observador } = entrada;
  return montarCorrente([
    new LimiteDeIntencoes(entrada.limitePadrao, observador),
    new LimiteDeSorteios(
      entrada.intencoesDeSorteio,
      entrada.limiteDeSorteio,
      entrada.mensagemDeSorteio,
      observador,
    ),
    new BarreiraDeEspectador(sala, observador),
    new ValidacaoDePayload(observador),
    new Autorizacao(sala, observador),
    new ExecucaoDoHandler(sala, observador),
  ]);
}
