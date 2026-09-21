/**
 * sorteios.ts — a familia de acoes ao acaso, com o esqueleto num lugar so
 * (padrao TEMPLATE METHOD, GoF).
 *
 * ─── A FAMILIA ──────────────────────────────────────────────────────────────
 *
 * Cinco intencoes: rolar dado, girar moeda, sortear um jogador, sortear uma
 * carta de uma zona e descartar ao acaso. Elas nao parecem iguais — uma muta
 * estado, outra so transmite um evento, outra so escreve no log — mas todas
 * fazem os mesmos cinco passos, nesta ordem:
 *
 *   1. checar se pode;
 *   2. SORTEAR (e este e o unico passo que toca `services/rng.ts`);
 *   3. aplicar o resultado no estado, se houver o que aplicar;
 *   4. anunciar para quem tem direito de ver;
 *   5. registrar no log.
 *
 * ─── POR QUE ISSO VIROU UMA CLASSE-BASE, E NAO CINCO HANDLERS PARECIDOS ─────
 *
 * Porque a ordem carrega duas regras do projeto que ninguem consegue verificar
 * lendo cinco funcoes separadas:
 *
 * RN06 — ALEATORIEDADE SO POR `services/rng.ts`. Com o sorteio confinado a um
 * passo com nome, "onde entra o acaso nesta acao?" tem UMA resposta, e o
 * revisor sabe onde olhar. Antes, a chamada ao CSPRNG ficava no meio do corpo
 * de cada handler, misturada a mutacao.
 *
 * AUDITORIA — TODO SORTEIO APARECE NO LOG. O log da mesa e o que permite a uma
 * mesa desconfiada conferir o que aconteceu (DOC-032 §RNG). `narrar` e
 * abstrato: nao existe subclasse que esqueca de registrar, porque o esqueleto
 * chama `ctx.log` sozinho e nao compila sem a frase.
 *
 * `aplicar` e `anunciar` sao GANCHOS com implementacao vazia: a subclasse so
 * escreve o passo que ela realmente tem. `permitido` tem padrao `true`.
 *
 * O QUE A SUBCLASSE NAO PODE FAZER e mudar a ordem — e isso e o ponto do
 * padrao. Anunciar antes de aplicar mandaria a mesa desenhar um resultado que
 * o estado ainda nao tem; registrar antes de sortear registraria a intencao, e
 * nao o que saiu.
 */

import type { LogEvent, Zone } from '@aethertable/shared-types';
import type { z } from 'zod';

import { concede } from '../schema/visibility';
import { criarLog, logDado, logSistema, nomeDaZona } from '../services/log';
import { aplicarEfeitosDeZona, atualizarContagens, carta, nomeDe, ordem } from '../services/mesa';
import { embaralhar, girarMoeda, rolarDado, sortear } from '../services/rng';
import { reconciliarCartaParaTodos } from '../services/view-sync';
import type { Autorizacao, IntentContext, IntentHandler } from './registry';
import * as S from './schemas';

/**
 * O esqueleto. `Payload` e o que o schema Zod entrega; `Resultado` e o que o
 * sorteio produziu — um numero, uma face, um id, uma lista de cartas.
 *
 * A classe satisfaz `IntentHandler` estruturalmente (`schema`, `autoriza`,
 * `executa`), entao uma instancia entra direto na tabela do REGISTRY: nao ha
 * adaptador, e o dispatcher nao sabe que esta chamando um metodo-template.
 */
export abstract class AcaoDeSorteio<
  Schema extends z.ZodTypeAny,
  Resultado,
> implements IntentHandler<Schema> {
  abstract readonly schema: Schema;
  readonly autoriza: Autorizacao = 'QUALQUER_JOGADOR';

  /**
   * O METODO-TEMPLATE. Nao e sobrescrito por nenhuma subclasse — quem precisa
   * variar tem cinco pontos para isso, e a ordem nao e um deles.
   */
  executa(ctx: IntentContext, payload: z.infer<Schema>): void {
    if (!this.permitido(ctx, payload)) return;

    const resultado = this.sortear(ctx, payload);
    // `null` e "o sorteio nao tinha de onde sair": zona vazia, mesa vazia. Nao
    // e erro — e a mesma saida silenciosa que os handlers ja tinham.
    if (resultado === null) return;

    this.aplicar(ctx, payload, resultado);
    this.anunciar(ctx, payload, resultado);
    ctx.log(this.narrar(ctx, payload, resultado));
  }

  /** Gancho. Padrao: pode. Quem barra, responde o erro aqui dentro. */
  protected permitido(_ctx: IntentContext, _payload: z.infer<Schema>): boolean {
    return true;
  }

  /** O UNICO passo autorizado a chamar `services/rng.ts` (RN06). */
  protected abstract sortear(ctx: IntentContext, payload: z.infer<Schema>): Resultado | null;

  /** Gancho. Muta o estado a partir do resultado. Padrao: nada a mutar. */
  protected aplicar(_ctx: IntentContext, _payload: z.infer<Schema>, _r: Resultado): void {}

  /** Gancho. Transmite. Padrao: nada a transmitir — o log ja e publico. */
  protected anunciar(_ctx: IntentContext, _payload: z.infer<Schema>, _r: Resultado): void {}

  /** Obrigatorio: nao existe sorteio fora do log. */
  protected abstract narrar(ctx: IntentContext, payload: z.infer<Schema>, r: Resultado): LogEvent;
}

// ─── Dado ────────────────────────────────────────────────────────────────────

export class RolarDado extends AcaoDeSorteio<typeof S.RollDiceIntent, number> {
  readonly schema = S.RollDiceIntent;

  protected override sortear(_ctx: IntentContext, { sides }: { sides: number }): number {
    return rolarDado(sides);
  }

  protected override anunciar(
    ctx: IntentContext,
    { sides }: { sides: number },
    resultado: number,
  ): void {
    ctx.broadcast('dice', { actorId: ctx.client.sessionId, sides, result: resultado });
  }

  protected override narrar(
    ctx: IntentContext,
    { sides }: { sides: number },
    resultado: number,
  ): LogEvent {
    const sid = ctx.client.sessionId;
    return logDado(sid, nomeDe(ctx.state, sid), sides, resultado);
  }
}

// ─── Moeda ───────────────────────────────────────────────────────────────────

export class GirarMoeda extends AcaoDeSorteio<typeof S.FlipCoinIntent, 'CARA' | 'COROA'> {
  readonly schema = S.FlipCoinIntent;

  protected override sortear(): 'CARA' | 'COROA' {
    return girarMoeda();
  }

  /**
   * O dado transmitia um evento efemero; a moeda so escrevia no log. A
   * assimetria nao era intencional: quem girava a moeda nao via nada acontecer
   * na mesa, e o resultado se perdia na primeira rolagem de log.
   */
  protected override anunciar(ctx: IntentContext, _p: unknown, face: 'CARA' | 'COROA'): void {
    ctx.broadcast('coin', { actorId: ctx.client.sessionId, result: face });
  }

  protected override narrar(ctx: IntentContext, _p: unknown, face: 'CARA' | 'COROA'): LogEvent {
    const sid = ctx.client.sessionId;
    return criarLog('DICE', sid, `${nomeDe(ctx.state, sid)} girou a moeda: ${face}`);
  }
}

// ─── Jogador ─────────────────────────────────────────────────────────────────

export class SortearJogador extends AcaoDeSorteio<typeof S.RandomPlayerIntent, string> {
  readonly schema = S.RandomPlayerIntent;

  protected override sortear(ctx: IntentContext): string | null {
    return sortear(Array.from(ctx.state.players.keys())) ?? null;
  }

  protected override narrar(ctx: IntentContext, _p: unknown, escolhido: string): LogEvent {
    return criarLog(
      'DICE',
      ctx.client.sessionId,
      `Sorteio: ${nomeDe(ctx.state, escolhido)} foi escolhido`,
    );
  }
}

// ─── Carta ───────────────────────────────────────────────────────────────────

export class SortearCarta extends AcaoDeSorteio<typeof S.RandomCardIntent, string> {
  readonly schema = S.RandomCardIntent;
  override readonly autoriza: Autorizacao = 'OWNER_DA_ZONA';

  protected override sortear(ctx: IntentContext, { zone }: { zone: Zone }): string | null {
    const lista = ordem(ctx.state, ctx.client.sessionId, zone);
    if (!lista || lista.length === 0) return null;
    return sortear(Array.from(lista)) ?? null;
  }

  protected override aplicar(ctx: IntentContext, _p: { zone: Zone }, id: string): void {
    const c = carta(ctx.state, id);
    if (!c) return;
    c.peekedBy = concede(c.peekedBy, ctx.client.sessionId);
    reconciliarCartaParaTodos(ctx.clients, c);
  }

  /**
   * A identidade vai SO para o dono. Um broadcast aqui vazaria a mao — e e por
   * isso que `anunciar` recebe o `ctx` inteiro em vez de um "broadcast": quem
   * decide o alcance e a subclasse.
   */
  protected override anunciar(ctx: IntentContext, _p: { zone: Zone }, id: string): void {
    const c = carta(ctx.state, id);
    if (!c) return;
    ctx.send('revealToOwner', { cards: [{ id: c.id, scryfallId: c.scryfallId }] });
  }

  protected override narrar(ctx: IntentContext, { zone }: { zone: Zone }): LogEvent {
    const sid = ctx.client.sessionId;
    return criarLog(
      'DICE',
      sid,
      `${nomeDe(ctx.state, sid)} sorteou uma carta de ${nomeDaZona(zone)}`,
    );
  }
}

// ─── Descarte ao acaso ───────────────────────────────────────────────────────

/**
 * A subclasse que justifica o desenho: aqui `sortear` e `aplicar` sao
 * realmente duas coisas.
 *
 * O handler antigo sorteava um indice, mexia na mao, sorteava outro, mexia de
 * novo — o acaso e a mutacao intercalados no mesmo laco. Separados, da para ler
 * (e testar) a amostragem sem estado: `n` cartas DISTINTAS da mao, sem
 * reposicao, que e o que "descartar 2 ao acaso" quer dizer.
 */
export class DescartarAoAcaso extends AcaoDeSorteio<typeof S.DiscardRandomIntent, string[]> {
  readonly schema = S.DiscardRandomIntent;

  protected override sortear(ctx: IntentContext, { amount }: { amount: number }): string[] | null {
    const mao = ordem(ctx.state, ctx.client.sessionId, 'HAND');
    if (!mao || mao.length === 0) return null;
    // Amostra sem reposicao: embaralha uma COPIA e corta. `abaixoDe` continua
    // valendo para quem sorteia um so — aqui a copia e mais barata que n
    // sorteios com descarte de repetidos.
    return embaralhar(Array.from(mao)).slice(0, Math.min(amount, mao.length));
  }

  protected override aplicar(ctx: IntentContext, _p: unknown, escolhidas: string[]): void {
    const sid = ctx.client.sessionId;
    const mao = ordem(ctx.state, sid, 'HAND');
    const cemiterio = ordem(ctx.state, sid, 'GRAVEYARD');
    if (!mao || !cemiterio) return;

    for (const id of escolhidas) {
      const indice = Array.from(mao).indexOf(id);
      if (indice < 0) continue;
      mao.splice(indice, 1);
      const c = carta(ctx.state, id);
      if (!c) continue;
      cemiterio.push(id);
      aplicarEfeitosDeZona(ctx, c, 'GRAVEYARD');
    }

    atualizarContagens(ctx.state, sid);
  }

  protected override narrar(ctx: IntentContext, _p: unknown, escolhidas: string[]): LogEvent {
    const sid = ctx.client.sessionId;
    // Neutro: conta quantas, nunca quais (RN09).
    return logSistema(
      sid,
      `${nomeDe(ctx.state, sid)} descartou ${escolhidas.length} carta(s) ao acaso`,
    );
  }
}
