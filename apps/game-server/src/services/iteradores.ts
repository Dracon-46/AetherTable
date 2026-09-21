/**
 * iteradores.ts — percorrer zona e mesa sem que o handler saiba como elas sao
 * guardadas (padrao ITERATOR, GoF).
 *
 * ─── O DEFEITO QUE ISTO CORRIGE ─────────────────────────────────────────────
 *
 * Onze handlers do REGISTRY percorriam `zoneOrder` na mao, e todos precisavam
 * saber TRES coisas que nao sao problema deles:
 *
 *   1. que o topo do grimorio e o FIM do array (`pop()`, nao `shift()`);
 *   2. que `zoneOrder` guarda ids e a carta vem de `state.cards` — podendo
 *      nao vir (ficha destruida), o que obriga um `continue` em cada laco;
 *   3. que a lista e um `ArraySchema`, e que mutar o array durante a travessia
 *      e seguro so porque a travessia vai de tras para frente.
 *
 * Quando as tres regras vivem em onze lugares, elas valem em onze lugares ate
 * alguem escrever o decimo segundo laco. O defeito de `INTENT_SHUFFLE` com
 * `keepTop` — que embaralhava o topo junto — nasceu exatamente assim: um laco
 * novo que leu "topo" como inicio do array.
 *
 * ─── O QUE O PADRAO DA, ALEM DE TIRAR DUPLICACAO ────────────────────────────
 *
 * A mesma interface (`Iterador`) atende travessias que nao tem nada em comum
 * entre si: ler do topo sem tirar (scry), tirar do topo (comprar, moer), tirar
 * ao acaso (descarte aleatorio) e girar em circulo sem fim (a vez na mesa).
 * Quem consome escreve `for (const carta of ...)` e nao muda quando a ordem da
 * travessia muda — que e a promessa do padrao.
 *
 * REGRA QUE CONTINUA VALENDO: sorteio SO por `services/rng.ts` (RN06). O
 * iterador ao acaso chama `abaixoDe`, nunca `Math.random()`.
 */

import { zoneOrderKey, type Zone } from '@aethertable/shared-types';

import type { Card } from '../schema/Card';
import type { Player } from '../schema/Player';
import type { RoomState } from '../schema/RoomState';
import { abaixoDe } from './rng';

/**
 * A interface do padrao. `Iterable` vem junto de proposito: `for...of` do
 * JavaScript JA E o protocolo de iterador, e implementar os dois deixa o
 * consumidor escolher entre o laco idiomatico e o controle passo a passo
 * (`temProximo`/`proximo`), que e o que `INTENT_PASS_TURN` precisa.
 */
export interface Iterador<T> extends Iterable<T> {
  temProximo(): boolean;
  proximo(): T | undefined;
}

/** Direcao da travessia. TOPO e o fim do array (DOC-032 §2). */
export type Sentido = 'TOPO' | 'FUNDO';

/**
 * O minimo que o iterador precisa da lista de ids.
 *
 * Estrutural, e nao `ArraySchema<string>`, por um motivo pratico: o teste monta
 * a zona com um array comum, e o iterador nao tem por que saber a diferenca.
 */
export interface ListaDeIds {
  readonly length: number;
  [indice: number]: string | undefined;
  push(...ids: string[]): unknown;
  pop(): string | undefined;
  unshift(...ids: string[]): unknown;
  splice(inicio: number, quantidade: number, ...ids: string[]): unknown;
}

// ─── Zona ────────────────────────────────────────────────────────────────────

/**
 * Agregado: a zona de um jogador. Sabe onde a lista mora e como resolver id em
 * carta; nao sabe em que ordem alguem quer percorre-la.
 */
export class ZonaDeCartas {
  private constructor(
    private readonly state: RoomState,
    readonly dono: string,
    readonly zona: Zone,
    private readonly itens: ListaDeIds,
  ) {}

  /**
   * Devolve `null` quando a zona nao existe para aquele jogador — que e o
   * mesmo `if (!grimorio) return` que cada handler escrevia, agora num lugar so.
   */
  static de(state: RoomState, dono: string, zona: Zone): ZonaDeCartas | null {
    const lista = state.zoneOrder.get(zoneOrderKey(dono, zona))?.items;
    if (!lista) return null;
    return new ZonaDeCartas(state, dono, zona, lista);
  }

  get tamanho(): number {
    return this.itens.length;
  }

  /** Percorre SEM tirar. `limite` recorta; sem ele, a zona inteira. */
  percorrer(sentido: Sentido = 'TOPO', limite = Number.POSITIVE_INFINITY): Iterador<Card> {
    return new IteradorDeZona(this.state, this.itens, sentido, limite);
  }

  /**
   * Percorre TIRANDO da lista. Cada `proximo()` remove o id antes de devolver a
   * carta — e o que comprar, moer e descartar fazem.
   */
  retirar(sentido: SentidoDeRetirada, quantidade: number): Iterador<Card> {
    return new IteradorDeRetirada(this.state, this.itens, sentido, quantidade);
  }

  /**
   * Os ids do topo, sem tocar na lista. Existe porque tres handlers precisam
   * dos IDS (para `concederOlhada`), e nao das cartas.
   */
  idsDoTopo(quantidade: number): string[] {
    const ids: string[] = [];
    for (let i = this.itens.length - 1; i >= 0 && ids.length < quantidade; i -= 1) {
      const id = this.itens[i];
      if (id) ids.push(id);
    }
    return ids;
  }

  /** Todos os ids, na ordem da lista (fundo primeiro). */
  todosOsIds(): string[] {
    const ids: string[] = [];
    for (let i = 0; i < this.itens.length; i += 1) {
      const id = this.itens[i];
      if (id) ids.push(id);
    }
    return ids;
  }

  /**
   * Reescreve a ordem inteira: ESVAZIA E REPOVOA, nunca `splice(0, n, ...ids)`.
   *
   * ─── A DIFERENCA NAO E DE ESTILO ────────────────────────────────────────
   *
   * `ArraySchema.splice(0, length, ...ids)` devolve a lista com o conteudo
   * certo e o tamanho certo — e deixa o `pop()` quebrado: a partir dali ele
   * devolve `undefined` sem encolher a lista, em silencio. Quem embaralhava e
   * comprava em seguida comprava zero cartas, porque o `pop()` da compra
   * batia nesse estado. O aviso do proprio `@colyseus/schema` ("trying to
   * delete non-existing index") era a unica pista, e so aparece em teste.
   *
   * Esvaziar com `splice(0, length)` (sem itens) e repovoar com `push`
   * preserva o `pop()`. Esta e a razao de reordenacao ser metodo do agregado e
   * nao um `splice` solto em cinco handlers: a regra tem UM lugar onde valer.
   */
  reordenar(ids: string[]): void {
    this.itens.splice(0, this.itens.length);
    for (const id of ids) this.itens.push(id);
  }

  /** Poe a carta de volta, no fundo. Ver `INTENT_MOVE_TOP_TO_BOTTOM`. */
  porNoFundo(id: string): void {
    this.itens.unshift(id);
  }

  /** Poe a carta no topo. E o destino de quem compra, moe ou descarta. */
  porNoTopo(id: string): void {
    this.itens.push(id);
  }
}

/**
 * Iterador de leitura. Segura um indice, nao uma copia: a lista pode encolher
 * por baixo (uma ficha destruida some de `state.cards`) e a travessia continua
 * valida porque cada passo revalida o id.
 */
class IteradorDeZona implements Iterador<Card> {
  private cursor: number;
  private entregues = 0;
  private buffer: Card | undefined;

  constructor(
    private readonly state: RoomState,
    private readonly itens: ListaDeIds,
    private readonly sentido: Sentido,
    private readonly limite: number,
  ) {
    this.cursor = sentido === 'TOPO' ? itens.length - 1 : 0;
  }

  temProximo(): boolean {
    this.carregar();
    return this.buffer !== undefined;
  }

  proximo(): Card | undefined {
    this.carregar();
    const atual = this.buffer;
    this.buffer = undefined;
    if (atual) this.entregues += 1;
    return atual;
  }

  [Symbol.iterator](): Iterator<Card> {
    return {
      next: () => {
        const valor = this.proximo();
        return valor ? { value: valor, done: false } : { value: undefined, done: true };
      },
    };
  }

  /**
   * Adianta ate achar uma carta que ainda existe.
   *
   * O `continue` que cada handler escrevia (`const c = carta(...); if (!c)
   * continue;`) vive aqui. Sem ele, um id orfao — ficha que deixou de existir
   * ao sair do campo — interromperia a travessia no meio.
   */
  private carregar(): void {
    if (this.buffer) return;
    while (this.entregues < this.limite && this.cursor >= 0 && this.cursor < this.itens.length) {
      const id = this.itens[this.cursor];
      this.cursor += this.sentido === 'TOPO' ? -1 : 1;
      if (!id) continue;
      const c = this.state.cards.get(id);
      if (c) {
        this.buffer = c;
        return;
      }
    }
  }
}

/** Como escolher a proxima carta a sair. */
export type SentidoDeRetirada = 'TOPO' | 'ACASO';

/**
 * Iterador que CONSOME. Tira o id da lista e devolve a carta.
 *
 * A contagem (`quantidade`) e do que foi PEDIDO, e o iterador para sozinho
 * quando a zona acaba antes — o `Math.min(amount, lista.length)` que cada
 * handler repetia. Quem precisa saber se faltou (so `INTENT_DRAW`, para a
 * derrota por grimorio vazio) compara `zona.tamanho` antes de comecar.
 */
class IteradorDeRetirada implements Iterador<Card> {
  private entregues = 0;
  private buffer: Card | undefined;

  constructor(
    private readonly state: RoomState,
    private readonly itens: ListaDeIds,
    private readonly sentido: SentidoDeRetirada,
    private readonly quantidade: number,
  ) {}

  /**
   * CARREGAMENTO PREGUICOSO, E ISTO NAO E OTIMIZACAO.
   *
   * Este iterador TIRA a carta da zona para poder devolve-la. Se ele
   * adiantasse a primeira no construtor, `zona.retirar(...)` sozinho — sem
   * nenhum `for` depois — ja teria comprado uma carta, e ela sumiria sem ir
   * para lugar nenhum.
   */
  temProximo(): boolean {
    this.carregar();
    return this.buffer !== undefined;
  }

  proximo(): Card | undefined {
    this.carregar();
    const atual = this.buffer;
    this.buffer = undefined;
    if (atual) this.entregues += 1;
    return atual;
  }

  [Symbol.iterator](): Iterator<Card> {
    return {
      next: () => {
        const valor = this.proximo();
        return valor ? { value: valor, done: false } : { value: undefined, done: true };
      },
    };
  }

  private carregar(): void {
    if (this.buffer) return;
    while (this.entregues < this.quantidade && this.itens.length > 0) {
      // TOPO sai por `pop`, e nao por `splice(length - 1, 1)`: o `ArraySchema`
      // do Colyseus trata a remocao do ultimo indice como caso proprio, e o
      // splice equivalente faz o ChangeTree reclamar de indice inexistente.
      //
      // ACASO usa `abaixoDe` porque `Math.random()` e proibido no game-server
      // (RN06) — a ordem do grimorio e informacao oculta, e um PRNG previsivel
      // e trapaca sem rastro.
      let id: string | undefined;
      if (this.sentido === 'TOPO') {
        id = this.itens.pop();
      } else {
        const indice = abaixoDe(this.itens.length);
        id = this.itens[indice];
        this.itens.splice(indice, 1);
      }
      if (!id) continue;
      const c = this.state.cards.get(id);
      if (c) {
        this.buffer = c;
        return;
      }
    }
  }
}

// ─── Mesa ────────────────────────────────────────────────────────────────────

/**
 * Agregado: os assentos ocupados, em ordem de assento.
 *
 * A ordem e recalculada a cada travessia porque `removerJogador` reatribui
 * assentos a cada saida — guardar a lista entre intencoes daria a vez a um
 * assento que mudou de dono.
 */
export class MesaDeAssentos {
  private readonly assentos: Player[];

  constructor(private readonly state: RoomState) {
    this.assentos = Array.from(state.players.values()).sort((a, b) => a.seat - b.seat);
  }

  get vazia(): boolean {
    return this.assentos.length === 0;
  }

  /**
   * Iterador CIRCULAR a partir de quem esta na vez. Nao tem fim: `temProximo`
   * so e falso na mesa vazia.
   */
  aPartirDaVez(): IteradorDeTurno {
    return new IteradorDeTurno(this.assentos, this.state.activePlayerId);
  }
}

/**
 * Iterador circular sobre os assentos.
 *
 * `deuVolta()` responde a unica pergunta que o contador de turnos faz: a
 * rotacao passou do ultimo assento? Antes isso era `atual === assentos.length
 * - 1` escrito dentro do handler, junto do `% assentos.length` — duas metades
 * da mesma conta, em dois lugares, com o `-1` do `findIndex` (ninguem na vez)
 * funcionando por acidente aritmetico.
 */
export class IteradorDeTurno implements Iterador<Player> {
  private cursor: number;
  private voltou = false;

  constructor(
    private readonly assentos: readonly Player[],
    idAtual: string,
  ) {
    // -1 quando ninguem esta na vez (antes do primeiro START_MATCH, ou depois
    // de um RESET): a rotacao comeca no assento 0, e e isso que destrava a mesa.
    this.cursor = assentos.findIndex((p) => p.id === idAtual);
  }

  temProximo(): boolean {
    return this.assentos.length > 0;
  }

  proximo(): Player | undefined {
    if (this.assentos.length === 0) return undefined;
    this.voltou = this.cursor === this.assentos.length - 1;
    this.cursor = (this.cursor + 1) % this.assentos.length;
    return this.assentos[this.cursor];
  }

  /** `true` quando o ultimo `proximo()` deu a volta na mesa. */
  deuVolta(): boolean {
    return this.voltou;
  }

  [Symbol.iterator](): Iterator<Player> {
    return {
      next: () => {
        const valor = this.proximo();
        return valor ? { value: valor, done: false } : { value: undefined, done: true };
      },
    };
  }
}
