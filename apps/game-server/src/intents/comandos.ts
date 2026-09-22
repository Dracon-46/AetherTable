/**
 * comandos.ts — toda intencao que muta a mesa vira um objeto (padrao COMMAND,
 * GoF), e o historico e quem sabe desfazer.
 *
 * ─── O QUE HAVIA ANTES, E POR QUE INCOMODAVA ────────────────────────────────
 *
 * Desfazer existia, e funcionava, mas estava espalhado em tres lugares que
 * precisavam concordar sem nunca se falarem:
 *
 *   1. `AetherRoom` chamava `jornal.registrar(state, sid, tipo)` ANTES de
 *      `handler.executa(...)` — a ordem era uma convencao guardada num
 *      comentario; inverter as duas linhas nao quebra teste nenhum e faz o
 *      snapshot sair DEPOIS da mutacao, tornando o undo um no-op silencioso;
 *   2. `services/undo.ts` decidia sozinho, por uma lista de nomes
 *      (`NAO_REVERSIVEIS`), o que podia ser desfeito;
 *   3. `INTENT_UNDO` era um handler como outro qualquer, que pedia `ctx.desfazer()`
 *      sem nenhuma relacao visivel com o que tinha sido feito antes.
 *
 * O resultado pratico: a acao e a capacidade de desfaze-la eram duas coisas
 * separadas, ligadas por um `Map<sid, Snapshot>` e por disciplina.
 *
 * ─── O QUE O PADRAO MUDA ────────────────────────────────────────────────────
 *
 * A acao passa a ser um objeto que carrega tudo de que ela precisa para
 * acontecer E para ser revertida. Quem executa nao decide quando capturar
 * estado — o comando captura, porque so ele sabe se e reversivel. E o
 * historico (o `Invoker`) so conhece a interface: executar, e desfazer o
 * ultimo dentro da janela.
 *
 * O ESTADO ANTERIOR CONTINUA SENDO UM SNAPSHOT: `services/undo.ts` perdeu o
 * `JornalUndo` (que virou o historico daqui) e ficou sendo o MEMENTO do
 * comando — o recorte, a janela e a lista do que nao volta atras. Undo por
 * memento e o que cabe aqui:
 * calcular a operacao inversa de "embaralhou e comprou tres" exigiria um
 * inverso por intencao, noventa e seis vezes, e cada um seria uma chance de
 * errar em silencio.
 */

import type { z } from 'zod';

import type { RoomState } from '../schema/RoomState';
import {
  capturar,
  restaurar,
  JANELA_UNDO_MS,
  NAO_REVERSIVEIS,
  type Snapshot,
} from '../services/undo';
import type { IntentContext, IntentHandler } from './registry';

/**
 * O que o historico sabe executar. `desfazer` so e chamado para quem responde
 * `true` em `reversivel`.
 */
export interface ComandoDeMesa {
  /** O tipo da intencao. E o que `INTENT_UNDO` anuncia no log. */
  readonly tipo: string;
  /** sessionId de quem mandou. O historico e por jogador. */
  readonly autor: string;
  executar(): void;
  reversivel(): boolean;
  desfazer(): void;
}

/**
 * Uma intencao do REGISTRY, encapsulada.
 *
 * O generico de `IntentHandler` e apagado aqui pelo mesmo motivo documentado
 * em `registrarIntencoes`: ao guardar handler e payload lado a lado, o
 * TypeScript intersecta todos os payloads possiveis e nada satisfaz o
 * resultado. A correlacao real e garantida pelo `satisfies` do REGISTRY, e
 * pelo fato de que quem monta o comando acabou de parsear com o schema DESTE
 * handler.
 */
export class ComandoDeIntencao implements ComandoDeMesa {
  private memento: Snapshot | null = null;

  constructor(
    readonly tipo: string,
    private readonly handler: IntentHandler<z.ZodTypeAny>,
    private readonly ctx: IntentContext,
    private readonly dados: unknown,
    private readonly state: RoomState,
  ) {}

  get autor(): string {
    return this.ctx.client.sessionId;
  }

  /**
   * CAPTURAR E EXECUTAR VIRARAM UM PASSO SO, e essa e a mudanca que importa.
   *
   * Enquanto eram duas chamadas na Room, nada impedia que alguem as
   * reordenasse — e um snapshot tirado depois da mutacao faz `INTENT_UNDO`
   * "restaurar" exatamente o estado que o jogador quer desfazer, sem erro
   * nenhum na tela.
   */
  executar(): void {
    this.memento = this.reversivel() ? capturar(this.state, this.autor, this.tipo) : null;
    this.handler.executa(this.ctx, this.dados);
  }

  /**
   * Aleatoriedade e revelacao nao voltam atras: desfazer um sorteio e uma
   * segunda tentativa, e informacao vista nao volta a ser oculta. A lista vive
   * em `services/undo.ts`, junto da explicacao de cada entrada.
   */
  reversivel(): boolean {
    return !NAO_REVERSIVEIS.has(this.tipo);
  }

  desfazer(): void {
    if (this.memento) restaurar(this.state, this.memento);
  }
}

/**
 * O Invoker: guarda O ULTIMO comando de cada jogador e sabe desfaze-lo dentro
 * da janela de arrependimento.
 *
 * Nao empilha (DOC-036 item 130): "desfazer" e a janela de dez segundos depois
 * de um clique errado, nao um historico de partida.
 */
export class HistoricoDeComandos {
  private readonly ultimo = new Map<string, { comando: ComandoDeMesa; em: number }>();

  /**
   * Executa e registra. A excecao sobe — quem trata e o despacho, que responde
   * `INTERNAL` ao cliente — mas o comando so entra no historico se a execucao
   * chegou ao fim: registrar uma acao que explodiu no meio daria ao jogador um
   * "desfazer" que restaura por cima de uma mutacao parcial.
   */
  executar(comando: ComandoDeMesa, agora = Date.now()): void {
    if (!comando.reversivel()) {
      // Uma acao irreversivel invalida o passado: desfazer "por cima" dela
      // restauraria um estado que nao existe mais.
      this.ultimo.delete(comando.autor);
      comando.executar();
      return;
    }
    comando.executar();
    this.ultimo.set(comando.autor, { comando, em: agora });
  }

  /** Devolve o tipo desfeito, ou `null` quando nao ha nada elegivel. */
  desfazer(sid: string, agora = Date.now()): string | null {
    const registro = this.ultimo.get(sid);
    if (!registro) return null;
    this.ultimo.delete(sid);
    if (agora - registro.em > JANELA_UNDO_MS) return null;
    registro.comando.desfazer();
    return registro.comando.tipo;
  }

  esquecer(sid: string): void {
    this.ultimo.delete(sid);
  }
}
