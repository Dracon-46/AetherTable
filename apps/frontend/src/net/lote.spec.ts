/**
 * lote.spec.ts — juntar as mudanças de um quadro numa escrita só.
 *
 * ─── O QUE ESTES CASOS PROTEGEM ────────────────────────────────────────────
 *
 * O ganho todo está em UMA afirmação: N mudanças no mesmo quadro produzem UMA
 * aplicação. Se alguém remover o agendamento — "é mais simples aplicar direto"
 * — nada quebra visivelmente: o estado final continua correto, e a mesa volta a
 * engasgar sem nenhum teste reclamar.
 *
 * Por isso o primeiro caso conta chamadas, e não resultados.
 *
 * O resto cobre a parte que PODE corromper estado: a ordem entre alterar e
 * remover. Uma carta atualizada e removida no mesmo quadro precisa sair; uma
 * carta removida e recriada precisa ficar. Errar isso produz carta fantasma ou
 * carta sumida — e as duas aparecem muitos segundos depois da causa.
 */

import { criarCoalescedor, type LoteDeCartas, type Relogio } from './lote';

/** Relógio de mentira: nada roda até `avancarQuadro()`. */
function relogioManual() {
  const pendentes = new Map<number, () => void>();
  let proximo = 1;
  const relogio: Relogio = {
    agendar(fn) {
      const id = proximo++;
      pendentes.set(id, fn);
      return id;
    },
    cancelar(id) {
      pendentes.delete(id);
    },
  };
  return {
    relogio,
    quadrosAgendados: () => pendentes.size,
    avancarQuadro() {
      const agora = [...pendentes.values()];
      pendentes.clear();
      for (const fn of agora) fn();
    },
  };
}

function montar() {
  const { relogio, avancarQuadro, quadrosAgendados } = relogioManual();
  const aplicacoes: Array<LoteDeCartas<{ x?: number }>> = [];
  const coalescedor = criarCoalescedor<{ x?: number }>((lote) => aplicacoes.push(lote), relogio);
  return { coalescedor, aplicacoes, avancarQuadro, quadrosAgendados };
}

describe('coalescedor de mudanças', () => {
  it('cinquenta mudanças no mesmo quadro viram UMA aplicação', () => {
    // A afirmação central. Sem o lote, isto seriam 50 cópias de `cards` e 50
    // renders do tabuleiro para mostrar o mesmo resultado.
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    for (let i = 0; i < 50; i += 1) coalescedor.alterar(`carta-${i}`, { x: i });
    expect(aplicacoes).toHaveLength(0); // nada foi aplicado ainda

    avancarQuadro();
    expect(aplicacoes).toHaveLength(1);
    expect(aplicacoes[0]!.alteradas.size).toBe(50);
  });

  it('a MESMA carta mexida vinte vezes chega com o último valor', () => {
    // É o caso do arraste: 20 atualizações de posição por segundo, das quais só
    // a última tem alguma chance de ser vista.
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    for (let i = 0; i < 20; i += 1) coalescedor.alterar('carta', { x: i });
    avancarQuadro();

    expect(aplicacoes).toHaveLength(1);
    expect(aplicacoes[0]!.alteradas.size).toBe(1);
    expect(aplicacoes[0]!.alteradas.get('carta')).toEqual({ x: 19 });
  });

  it('só agenda UM quadro, por mais mudanças que cheguem', () => {
    // Agendar por mudança devolveria o problema pela porta dos fundos: a
    // aplicação seria uma, mas o navegador teria 50 callbacks para processar.
    const { coalescedor, avancarQuadro, quadrosAgendados } = montar();

    for (let i = 0; i < 30; i += 1) coalescedor.alterar(`c${i}`, { x: i });
    expect(quadrosAgendados()).toBe(1);

    avancarQuadro();
    expect(quadrosAgendados()).toBe(0);
  });

  it('quadros diferentes são aplicações diferentes', () => {
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    coalescedor.alterar('a', { x: 1 });
    avancarQuadro();
    coalescedor.alterar('b', { x: 2 });
    avancarQuadro();

    expect(aplicacoes).toHaveLength(2);
    expect([...aplicacoes[0]!.alteradas.keys()]).toEqual(['a']);
    expect([...aplicacoes[1]!.alteradas.keys()]).toEqual(['b']);
  });

  it('alterar e depois remover no mesmo quadro: a carta SAI', () => {
    // Carta que recebe um último patch de posição e em seguida deixa a mesa.
    // Se a alteração sobrevivesse, ela seria recriada — uma carta fantasma.
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    coalescedor.alterar('carta', { x: 5 });
    coalescedor.remover('carta');
    avancarQuadro();

    expect(aplicacoes[0]!.alteradas.has('carta')).toBe(false);
    expect(aplicacoes[0]!.removidas.has('carta')).toBe(true);
  });

  it('remover e depois alterar no mesmo quadro: a carta FICA', () => {
    // O inverso: a carta sai e volta (mudança de zona que passa por remoção).
    // Manter a remoção aqui apagaria uma carta que existe.
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    coalescedor.remover('carta');
    coalescedor.alterar('carta', { x: 9 });
    avancarQuadro();

    expect(aplicacoes[0]!.removidas.has('carta')).toBe(false);
    expect(aplicacoes[0]!.alteradas.get('carta')).toEqual({ x: 9 });
  });

  it('nada pendente não gera aplicação nenhuma', () => {
    // Um render vazio por quadro custaria mais do que o lote economiza.
    const { coalescedor, aplicacoes, avancarQuadro } = montar();
    avancarQuadro();
    coalescedor.descarregar();
    expect(aplicacoes).toHaveLength(0);
  });

  it('`descarregar` aplica na hora e desmarca o quadro', () => {
    const { coalescedor, aplicacoes, avancarQuadro, quadrosAgendados } = montar();

    coalescedor.alterar('a', { x: 1 });
    coalescedor.descarregar();

    expect(aplicacoes).toHaveLength(1);
    expect(quadrosAgendados()).toBe(0);

    // E o quadro que ficou para trás não aplica de novo.
    avancarQuadro();
    expect(aplicacoes).toHaveLength(1);
  });

  it('`cancelar` esquece o pendente — o quadro não repovoa uma sala deixada', () => {
    /**
     * É a limpeza da desmontagem. Sem ela, o quadro agendado dispararia DEPOIS
     * do `reset()` do store e escreveria de volta as cartas da mesa que o
     * jogador acabou de deixar — uma mesa fantasma na tela seguinte.
     */
    const { coalescedor, aplicacoes, avancarQuadro } = montar();

    coalescedor.alterar('a', { x: 1 });
    coalescedor.cancelar();
    avancarQuadro();

    expect(aplicacoes).toHaveLength(0);
  });

  it('mudanças que chegam durante a aplicação vão para o quadro seguinte', () => {
    // O store pode disparar um render que produz mudanças novas. Se elas
    // caíssem na coleção que está sendo consumida, seriam perdidas.
    const { relogio, avancarQuadro } = relogioManual();
    const aplicacoes: Array<LoteDeCartas<{ x?: number }>> = [];
    const coalescedor = criarCoalescedor<{ x?: number }>((lote) => {
      aplicacoes.push(lote);
      if (aplicacoes.length === 1) coalescedor.alterar('reentrante', { x: 99 });
    }, relogio);

    coalescedor.alterar('a', { x: 1 });
    avancarQuadro();
    expect([...aplicacoes[0]!.alteradas.keys()]).toEqual(['a']);

    avancarQuadro();
    expect(aplicacoes).toHaveLength(2);
    expect(aplicacoes[1]!.alteradas.get('reentrante')).toEqual({ x: 99 });
  });
});
