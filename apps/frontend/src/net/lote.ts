'use client';

/**
 * lote.ts — juntar as mudanças de um quadro numa escrita só.
 *
 * ─── O PROBLEMA, EM NÚMEROS ────────────────────────────────────────────────
 *
 * `upsertCard` faz `{ ...s.cards, [id]: {...} }`. Numa mesa de Commander com
 * quatro jogadores, `cards` tem em torno de 400 chaves — e essa cópia acontecia
 * uma vez por CAMPO alterado, não uma vez por quadro.
 *
 * O servidor manda patch a 20 Hz (`PATCH_RATE_MS: 50`). Um patch carrega as
 * mudanças de várias cartas de uma vez, e cada uma disparava o próprio callback
 * e a própria cópia. Arrastar uma carta sozinho já produz 20 atualizações de
 * posição por segundo; com quatro pessoas mexendo na mesa, dezenas de cópias de
 * 400 chaves por quadro — e, pior, dezenas de identidades novas de `cards`.
 *
 * `GameBoard` assina o objeto inteiro (`useGameStore((s) => s.cards)`), então
 * cada identidade nova custa um render completo do tabuleiro e uma
 * reconciliação de todos os nós do Konva. O custo não vem da mesa ser grande —
 * vem de ela ser redesenhada N vezes no mesmo quadro para mostrar o mesmo
 * resultado final.
 *
 * ─── O QUE ISTO FAZ ────────────────────────────────────────────────────────
 *
 * Acumula as mudanças e aplica UMA vez por quadro de animação. N cópias viram
 * uma; N renders viram um. O estado final é idêntico — ninguém percebe
 * diferença exceto pela mesa parar de engasgar.
 *
 * ─── POR QUE `requestAnimationFrame` E NÃO UM TEMPORIZADOR ─────────────────
 *
 * Porque o destino do dado é a TELA. Aplicar mais de uma vez entre dois quadros
 * é trabalho que ninguém vê; aplicar menos de uma vez por quadro atrasaria o
 * desenho. O rAF é exatamente a cadência em que o resultado importa — e, de
 * quebra, ele PARA numa aba em segundo plano, onde continuar copiando 400
 * chaves seria puro desperdício de bateria.
 *
 * ─── A ORDEM ENTRE MUDAR E REMOVER PRECISA SOBREVIVER ──────────────────────
 *
 * Uma carta pode ser atualizada e removida no mesmo quadro (ela sai da mesa
 * logo após um último patch de posição). Se as duas coisas fossem guardadas em
 * listas separadas, a ordem de aplicação viraria sorte — e o caso ruim é a
 * remoção ser aplicada primeiro, com a atualização depois RESSUSCITANDO a
 * carta. Por isso remover descarta a atualização pendente daquele id, e o lote
 * carrega as duas informações juntas.
 */

export type LoteDeCartas<T> = {
  /** Mudanças por id, na ordem em que chegaram. `null` = remover. */
  alteradas: Map<string, T>;
  removidas: Set<string>;
};

export interface Coalescedor<T> {
  /** Enfileira uma mudança. Cancela uma remoção pendente do mesmo id. */
  alterar(id: string, dados: T): void;
  /** Enfileira uma remoção. Descarta a mudança pendente do mesmo id. */
  remover(id: string): void;
  /** Aplica agora o que estiver pendente, sem esperar o quadro. */
  descarregar(): void;
  /** Cancela o quadro agendado e esquece o pendente. Para a desmontagem. */
  cancelar(): void;
}

/** Injetável para o teste não depender de um navegador. */
export interface Relogio {
  agendar: (fn: () => void) => number;
  cancelar: (id: number) => void;
}

const RELOGIO_PADRAO: Relogio = {
  agendar: (fn) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(fn)
      : (setTimeout(fn, 16) as unknown as number),
  cancelar: (id) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  },
};

export function criarCoalescedor<T>(
  aplicar: (lote: LoteDeCartas<T>) => void,
  relogio: Relogio = RELOGIO_PADRAO,
): Coalescedor<T> {
  let alteradas = new Map<string, T>();
  let removidas = new Set<string>();
  let quadro: number | null = null;

  const temPendencia = () => alteradas.size > 0 || removidas.size > 0;

  const agendar = () => {
    if (quadro !== null) return;
    quadro = relogio.agendar(() => {
      quadro = null;
      descarregar();
    });
  };

  function descarregar(): void {
    if (!temPendencia()) return;
    const lote = { alteradas, removidas };
    // Troca as coleções ANTES de aplicar: `aplicar` chama o store, que pode
    // disparar um render que produz mais mudanças. Se elas caíssem no mesmo
    // objeto que está sendo consumido, seriam perdidas ou aplicadas duas vezes.
    alteradas = new Map();
    removidas = new Set();
    aplicar(lote);
  }

  return {
    alterar(id, dados) {
      removidas.delete(id);
      alteradas.set(id, dados);
      agendar();
    },
    remover(id) {
      alteradas.delete(id);
      removidas.add(id);
      agendar();
    },
    descarregar() {
      if (quadro !== null) {
        relogio.cancelar(quadro);
        quadro = null;
      }
      descarregar();
    },
    cancelar() {
      if (quadro !== null) {
        relogio.cancelar(quadro);
        quadro = null;
      }
      alteradas = new Map();
      removidas = new Set();
    },
  };
}
