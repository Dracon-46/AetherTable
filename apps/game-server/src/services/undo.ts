/**
 * undo.ts — o padrão MEMENTO (GoF) do desfazer da mesa: o recorte de estado
 * que um comando guarda para conseguir se desfazer (DOC-036 item 130, RN:
 * DOC-031; o desenho está no DOC-098).
 *
 * Quem decide QUANDO salvar e QUANDO restaurar é `intents/comandos.ts`; aqui
 * ficam o recorte, a janela e a lista do que não volta atrás.
 *
 * ─── OS TRÊS PAPÉIS ─────────────────────────────────────────────────────────
 *
 *   Originator  `RecorteDoJogador` — o pedaço da mesa que é de um jogador.
 *               Só ele sabe tirar a foto e só ele sabe reaplicá-la.
 *   Memento     `MementoDoRecorte` (o que o mundo vê) e `FotoDoRecorte` (o
 *               conteúdo, que não sai deste módulo).
 *   Caretaker   `ComandoDeIntencao` — guarda o memento sem abri-lo.
 *
 * ─── O QUE HAVIA ANTES, E POR QUE INCOMODAVA ────────────────────────────────
 *
 * O memento já existia, mas sem o padrão: `Snapshot` era uma interface pública
 * com `cartas`, `zonas` e `jogador` à mostra, e `capturar`/`restaurar` eram
 * duas funções soltas que precisavam concordar sobre o formato.
 *
 *   1. A FOTO ERA UM OBJETO ABERTO. Ela carrega a ordem do grimório e da mão —
 *      informação oculta. Qualquer código que segurasse o snapshot (o comando,
 *      um log de depuração, um teste) podia lê-la ou alterá-la; o padrão
 *      reduz o que o guardião enxerga a `autor`, `tipo` e `em`.
 *   2. `restaurar(state, snap)` APLICAVA QUALQUER COISA COM O FORMATO CERTO —
 *      um literal montado à mão, ou a foto de outra mesa, que seria reaplicada
 *      por id numa sala onde esses ids significam outras cartas. O originador
 *      só aceita a foto que ele mesmo tirou: da mesma mesa e do mesmo jogador.
 *   3. O recorte (que campos entram na foto) estava definido duas vezes, uma
 *      em cada função. Agora salvar e restaurar são métodos da mesma classe.
 *
 * O QUE ESTE MÓDULO NÃO FAZ, E POR QUÊ
 *
 * `INTENT_UNDO` desfaz a ÚLTIMA ação PRÓPRIA. Ele não desfaz:
 *
 *   - ação aleatória (embaralhar, sortear, dado, descarte aleatório) — desfazer
 *     e refazer um sorteio é simplesmente uma segunda tentativa, o que é
 *     trapaça com passos extras;
 *   - revelação e olhada — informação vista não volta a ser oculta; "desfazer"
 *     daria uma falsa sensação de privacidade;
 *   - qualquer coisa que tenha tocado o estado de OUTRO jogador.
 *
 * Por isso a foto cobre exatamente o recorte que pertence ao jogador: as
 * cartas de que ele é dono, as listas de ordem das zonas dele e os marcadores
 * do próprio Player. Restaurar esse recorte é sempre seguro; restaurar mais que
 * isso deixaria de ser "desfazer" e viraria "reescrever a mesa".
 */

import type { RoomState } from '../schema/RoomState';
import { zoneOrderKey, ZONES, type Zone } from '@aethertable/shared-types';

/** Janela de arrependimento. Depois disto, a ação virou história. */
export const JANELA_UNDO_MS = 10_000;

interface CartaSnapshot {
  zone: string;
  controllerId: string;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
  isTapped: boolean;
  faceDown: boolean;
  phasedOut: boolean;
  isFlipped: boolean;
  attachedTo: string;
  exiledBy: string;
  goadedBy: string;
  note: string;
  highlight: string;
  damage: number;
  powerOverride: number;
  toughnessOverride: number;
  hasPtOverride: boolean;
  enteredThisTurn: boolean;
  counters: [string, number][];
}

interface JogadorSnapshot {
  life: number;
  poison: number;
  energy: number;
  experience: number;
  rad: number;
  ticket: number;
  commanderTax: number;
  speed: number;
  ringLevel: number;
  ringBearerId: string;
  maxHandSize: number;
  isMonarch: boolean;
  hasInitiative: boolean;
  conceded: boolean;
  /** Desfazer a compra do grimório vazio não revivia o jogador sem isto. */
  decked: boolean;
  commanderDamage: [string, number][];
}

/**
 * MEMENTO — a interface ESTREITA: tudo o que o caretaker pode saber de uma
 * foto. O conteúdo não aparece aqui de propósito; ver o item 1 do cabeçalho.
 */
export interface MementoDoRecorte {
  /** sessionId de quem a foto pertence. */
  readonly autor: string;
  /** A intenção que estava para acontecer quando a foto foi tirada. */
  readonly tipo: string;
  readonly em: number;
}

/**
 * MEMENTO — a interface LARGA. Não é exportada: fora deste módulo ninguém
 * consegue nomear o tipo, e por isso só o `RecorteDoJogador` lê o conteúdo.
 *
 * `mesa` existe para o originador recusar a foto de outra sala; não é usada
 * para mais nada.
 */
class FotoDoRecorte implements MementoDoRecorte {
  constructor(
    readonly autor: string,
    readonly tipo: string,
    readonly em: number,
    readonly mesa: RoomState,
    readonly cartas: readonly (readonly [string, CartaSnapshot])[],
    readonly zonas: readonly (readonly [Zone, string[]])[],
    readonly jogador: JogadorSnapshot | null,
  ) {}
}

/**
 * ORIGINATOR — o recorte da mesa que pertence a um jogador.
 *
 * Não guarda estado próprio: o estado é o `RoomState`, que é um schema do
 * Colyseus e serializa por índice — pôr `salvar`/`restaurar` dentro dele
 * misturaria o padrão com o contrato de rede. O originador é a "janela" sobre
 * a parte da mesa que é do jogador, e é ela que define o recorte.
 */
export class RecorteDoJogador {
  constructor(
    private readonly state: RoomState,
    private readonly sid: string,
  ) {}

  /** `createMemento` do GoF. Copia tudo: a foto não pode mudar junto com a mesa. */
  salvar(tipo: string, agora = Date.now()): MementoDoRecorte {
    const { state, sid } = this;
    const cartas: [string, CartaSnapshot][] = [];
    state.cards.forEach((c, id) => {
      if (c.ownerId !== sid && c.controllerId !== sid) return;
      cartas.push([
        id,
        {
          zone: c.zone,
          controllerId: c.controllerId,
          x: c.x,
          y: c.y,
          rotation: c.rotation,
          zIndex: c.zIndex,
          isTapped: c.isTapped,
          faceDown: c.faceDown,
          phasedOut: c.phasedOut,
          isFlipped: c.isFlipped,
          attachedTo: c.attachedTo,
          exiledBy: c.exiledBy,
          goadedBy: c.goadedBy,
          note: c.note,
          highlight: c.highlight,
          damage: c.damage,
          powerOverride: c.powerOverride,
          toughnessOverride: c.toughnessOverride,
          hasPtOverride: c.hasPtOverride,
          enteredThisTurn: c.enteredThisTurn,
          counters: Array.from(c.counters.entries()),
        },
      ]);
    });

    const zonas: [Zone, string[]][] = [];
    for (const zona of ZONES) {
      const lista = state.zoneOrder.get(zoneOrderKey(sid, zona))?.items;
      if (lista) zonas.push([zona, Array.from(lista)]);
    }

    const p = state.players.get(sid);
    const jogador: JogadorSnapshot | null = p
      ? {
          life: p.life,
          poison: p.poison,
          energy: p.energy,
          experience: p.experience,
          rad: p.rad,
          ticket: p.ticket,
          commanderTax: p.commanderTax,
          speed: p.speed,
          ringLevel: p.ringLevel,
          ringBearerId: p.ringBearerId,
          maxHandSize: p.maxHandSize,
          isMonarch: p.isMonarch,
          hasInitiative: p.hasInitiative,
          conceded: p.conceded,
          decked: p.decked,
          commanderDamage: Array.from(p.commanderDamage.entries()),
        }
      : null;

    return new FotoDoRecorte(sid, tipo, agora, state, cartas, zonas, jogador);
  }

  /**
   * `setMemento` do GoF.
   *
   * Lança para a foto que não é deste recorte, em vez de ignorá-la: o único
   * caretaker (`ComandoDeIntencao`) monta o originador com a própria mesa e o
   * próprio autor, então chegar aqui com outra foto é defeito de quem chamou —
   * e um "desfazer" que responde "desfeito" sem mudar nada é exatamente o
   * no-op mudo que o Command veio fechar.
   */
  restaurar(memento: MementoDoRecorte): void {
    if (
      !(memento instanceof FotoDoRecorte) ||
      memento.mesa !== this.state ||
      memento.autor !== this.sid
    ) {
      throw new Error(
        `Memento de "${memento.autor}" não é deste recorte (mesa errada, jogador errado ou foto forjada)`,
      );
    }
    const { state, sid } = this;

    for (const [id, s] of memento.cartas) {
      const c = state.cards.get(id);
      // A carta pode ter deixado de existir (token destruido): nada a restaurar.
      if (!c) continue;
      c.zone = s.zone;
      c.controllerId = s.controllerId;
      c.x = s.x;
      c.y = s.y;
      c.rotation = s.rotation;
      c.zIndex = s.zIndex;
      c.isTapped = s.isTapped;
      c.faceDown = s.faceDown;
      c.phasedOut = s.phasedOut;
      c.isFlipped = s.isFlipped;
      c.attachedTo = s.attachedTo;
      c.exiledBy = s.exiledBy;
      c.goadedBy = s.goadedBy;
      c.note = s.note;
      c.highlight = s.highlight;
      c.damage = s.damage;
      c.powerOverride = s.powerOverride;
      c.toughnessOverride = s.toughnessOverride;
      c.hasPtOverride = s.hasPtOverride;
      c.enteredThisTurn = s.enteredThisTurn;
      c.counters.clear();
      for (const [nome, valor] of s.counters) c.counters.set(nome, valor);
    }

    for (const [zona, ids] of memento.zonas) {
      const lista = state.zoneOrder.get(zoneOrderKey(sid, zona))?.items;
      if (!lista) continue;
      /**
       * A LISTA QUE ENCOLHEU CRESCE ANTES DE SER REESCRITA.
       *
       * O `ArraySchema#splice` do Colyseus 3 recusa inserir mais do que remove — e
       * lança (a mesma armadilha de `inserirNaZona`, no registry). Desfazer
       * "joguei da mão" restaura uma mão MAIOR que a atual: o undo lançava aqui,
       * com as cartas já restauradas e as listas não, e a carta ficava com
       * `zone = 'HAND'` listada no campo. Cresce com `push` até a largura da foto
       * e reescreve na mesma largura, que o `splice` aceita.
       */
      if (ids.length > lista.length) lista.push(...ids.slice(lista.length));
      lista.splice(0, lista.length, ...ids);
    }

    /**
     * CARTA DE OUTRO DONO: AS LISTAS DELE TAMBEM.
     *
     * O recorte só restaurava as listas de quem desfez. Quem controlava a carta
     * de outra pessoa e a mandava para o grimório DELA, e depois desfazia, via a
     * carta voltar ao campo com o id ainda no grimório do dono — a próxima compra
     * dele puxava a carta do campo alheio para a mão. Restaurar a lista inteira
     * do dono apagaria o que ELE fez nesses dez segundos; por isso o conserto é
     * cirúrgico: o id sai de todas as listas do dono e volta só para a da zona
     * restaurada.
     */
    const donosAfetados = new Set<string>();
    for (const [id, s] of memento.cartas) {
      const c = state.cards.get(id);
      if (!c || c.ownerId === sid) continue;
      for (const zona of ZONES) {
        const lista = state.zoneOrder.get(zoneOrderKey(c.ownerId, zona))?.items;
        const i = lista ? lista.indexOf(id) : -1;
        if (lista && i !== -1) lista.splice(i, 1);
      }
      state.zoneOrder.get(zoneOrderKey(c.ownerId, s.zone as Zone))?.items.push(id);
      donosAfetados.add(c.ownerId);
    }
    for (const dono of donosAfetados) {
      const outro = state.players.get(dono);
      if (!outro) continue;
      outro.handCount = state.zoneOrder.get(zoneOrderKey(dono, 'HAND'))?.items.length ?? 0;
      outro.libraryCount = state.zoneOrder.get(zoneOrderKey(dono, 'LIBRARY'))?.items.length ?? 0;
    }

    const p = state.players.get(sid);
    if (p && memento.jogador) {
      const j = memento.jogador;
      p.life = j.life;
      p.poison = j.poison;
      p.energy = j.energy;
      p.experience = j.experience;
      p.rad = j.rad;
      p.ticket = j.ticket;
      p.commanderTax = j.commanderTax;
      p.speed = j.speed;
      p.ringLevel = j.ringLevel;
      p.ringBearerId = j.ringBearerId;
      p.maxHandSize = j.maxHandSize;
      p.isMonarch = j.isMonarch;
      p.hasInitiative = j.hasInitiative;
      p.conceded = j.conceded;
      p.decked = j.decked;
      p.commanderDamage.clear();
      for (const [de, valor] of j.commanderDamage) p.commanderDamage.set(de, valor);
      p.handCount = state.zoneOrder.get(zoneOrderKey(sid, 'HAND'))?.items.length ?? p.handCount;
      p.libraryCount =
        state.zoneOrder.get(zoneOrderKey(sid, 'LIBRARY'))?.items.length ?? p.libraryCount;
    }
  }
}

/**
 * Intencoes que NAO entram no jornal. Ver o bloco de abertura: aleatoriedade e
 * revelacao nao sao reversiveis, e desfazer um `UNDO` seria um `REDO` que
 * ninguem pediu.
 */
export const NAO_REVERSIVEIS: ReadonlySet<string> = new Set([
  'INTENT_UNDO',
  'INTENT_SHUFFLE',
  'INTENT_MULLIGAN',
  'INTENT_ROLL_DICE',
  'INTENT_FLIP_COIN',
  'INTENT_RANDOM_PLAYER',
  'INTENT_RANDOM_CARD',
  'INTENT_DISCARD_RANDOM',
  'INTENT_PEEK',
  'INTENT_CLOSE_PEEK',
  // Mesma razão do commit do scry: reordenar o que se viu (ou embaralhar o
  // bloco) não volta sem devolver a olhada, e a ordem aleatória não se desfaz.
  'INTENT_ARRANGE_PEEKED',
  'INTENT_SCRY',
  'INTENT_SURVEIL',
  // O commit do scry tambem nao volta (DOC-036 §4.2): desfazer devolveria a
  // ordem antiga sem devolver a sessao, e o jogador ficaria com cartas
  // reordenadas que ele ja viu e um scry que nao pode mais concluir.
  'INTENT_SCRY_COMMIT',
  'INTENT_SURVEIL_COMMIT',
  // Comprar e moer mostram cartas do grimorio: desfazer as devolvia ao topo na
  // MESMA ordem, ja conhecidas — uma olhada gratis no topo, contra a regra do
  // proprio modulo.
  'INTENT_DRAW',
  'INTENT_DRAW_UP_TO',
  'INTENT_MILL',
  // O recorte e das cartas que o jogador ja POSSUIA: fichas e copias criadas
  // depois dele nao eram removidas, e o "desfeito" nao mudava nada na mesa.
  'INTENT_CREATE_TOKEN',
  'INTENT_COPY_CARD',
  // Estado da MESA, nao do jogador: desfazer "tomar o Monarca" restaurava so
  // quem desfez e deixava a mesa sem monarca; desfazer passar o turno
  // anunciava "desfeito" sem devolver a vez.
  'INTENT_TOGGLE_DESIGNATION',
  'INTENT_PASS_TURN',
  'INTENT_SET_TURN',
  'INTENT_SET_DAY_NIGHT',
  // Voto dado e voto dado — e o ultimo voto ja tirou alguem da sala.
  'INTENT_VOTE_KICK',
  'INTENT_SEARCH_ZONE',
  /**
   * DEVOLVER UMA ZONA AO GRIMÓRIO EMBARALHA (`shuffle` vem `true` por padrão).
   *
   * Desfazível, ela era um "embaralhe até sair bom": devolver o cemitério
   * embaralhando, ver o resultado (com o topo revelado, por exemplo), desfazer
   * e repetir até o topo agradar. É a mesma regra de `INTENT_SHUFFLE` e
   * `INTENT_MULLIGAN`, que já estavam aqui. A intenção inteira, e não só o caso
   * com `shuffle`: a lista é por tipo, e o caso sem embaralhar não ganha nada
   * sendo desfazível.
   */
  'INTENT_RETURN_ZONE',
  'INTENT_REVEAL',
  'INTENT_REVEAL_TOP',
  'INTENT_REVEAL_ZONE',
  'INTENT_UNREVEAL',
  'INTENT_SET_ZONE_VISIBILITY',
  'INTENT_CHAT',
  'INTENT_PING',
  'INTENT_REACTION',
  // O snapshot de jogador não guarda o pool: desfazer só gastaria o slot.
  'INTENT_MANA_POOL',
  'INTENT_START_MATCH',
  'INTENT_RESET_MATCH',
  'INTENT_LEAVE',
  // Trocar de sleeve nao e jogada: desfazer aqui so tiraria do jogador a
  // possibilidade de desfazer a jogada anterior de verdade.
  'INTENT_SET_COSMETICS',

  // ── Sala de espera e mesa social ────────────────────────────────────────

  /**
   * DESFAZER "fiquei com a mao" REABRIRIA O MULLIGAN.
   *
   * `keptHand` e justamente o que fecha a janela de mulligan. Um undo que o
   * reabrisse devolveria, por uma porta lateral, o "compre sete cartas novas a
   * qualquer momento" que a janela existe para tirar. E nem funcionaria: o
   * snapshot de jogador nao guarda `keptHand`, entao a acao so serviria para
   * consumir o slot e impedir o jogador de desfazer a jogada anterior de
   * verdade.
   */
  'INTENT_KEEP_HAND',

  /** Prontidao ja e um interruptor: "desfazer" e clicar de novo. */
  'INTENT_SET_READY',

  /** Nao da para trazer de volta quem ja foi desconectado. */
  'INTENT_KICK_PLAYER',

  /**
   * Mesma razao de REVEAL e PEEK: informacao vista nao volta a ser oculta.
   * Desfazer uma resposta de visualizacao daria a falsa sensacao de que o
   * observador "des-viu" a mao — e o jeito certo de fechar e revogar, que e
   * uma acao propria e explicita.
   */
  'INTENT_REQUEST_VIEW',
  'INTENT_RESPOND_VIEW',
  'INTENT_REVOKE_VIEW',
]);
