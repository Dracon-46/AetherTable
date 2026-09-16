/**
 * reconexao.spec.ts — a vaga de quem caiu é dele, e ninguém entra no lugar.
 *
 * ─── O QUE ESTES CASOS PROTEGEM ────────────────────────────────────────────
 *
 * Uma partida de Commander leva três ou quatro horas. Nesse tempo um navegador
 * trava, um wi-fi cai, um notebook hiberna. A janela de reconexão era de 90
 * segundos — cobria um F5 e mais nada — e agora é de dez minutos, com a vaga
 * bloqueada durante todo o prazo.
 *
 * O bloqueio não é código novo: ele cai de `haAssentoLivre` contar
 * `state.players`, e o jogador desconectado continuar lá com `connected: false`.
 * É exatamente o tipo de comportamento que some numa refatoração inocente —
 * alguém "limpa" a contagem filtrando por `connected` e a vaga passa a ser
 * roubada em silêncio, no meio da partida de outra pessoa.
 *
 * Por isso os casos abaixo afirmam a CONSEQUÊNCIA (ninguém entra) em vez da
 * implementação (o jogador está no mapa).
 */

import { haAssentoLivre } from './registry';
import { RoomState } from '../schema/RoomState';
import { Player } from '../schema/Player';
import { REALTIME_LIMITS } from '@aethertable/shared-types';

function mesa(assentos: number, jogadores: Array<{ id: string; connected: boolean }>) {
  const state = new RoomState();
  state.maxSeats = assentos;
  for (const [indice, j] of jogadores.entries()) {
    const p = new Player();
    p.id = j.id;
    p.name = j.id.toUpperCase();
    p.seat = indice;
    p.connected = j.connected;
    if (!j.connected) p.disconnectedAt = Date.now();
    state.players.set(j.id, p);
  }
  return state;
}

describe('a vaga de quem caiu', () => {
  it('continua OCUPADA enquanto a janela de reconexão está aberta', () => {
    // O caso da queixa: quatro assentos, quatro jogadores, um deles caiu. A
    // mesa NÃO pode aceitar um quinto entrando na vaga dele.
    const state = mesa(4, [
      { id: 'ana', connected: true },
      { id: 'bruno', connected: false }, // caiu, janela aberta
      { id: 'caio', connected: true },
      { id: 'dora', connected: true },
    ]);

    expect(haAssentoLivre(state)).toBe(false);
  });

  it('um assento de verdade livre continua sendo livre', () => {
    // O oposto: bloquear vaga vazia impediria a mesa de encher.
    const state = mesa(4, [
      { id: 'ana', connected: true },
      { id: 'bruno', connected: false },
      { id: 'caio', connected: true },
    ]);

    expect(haAssentoLivre(state)).toBe(true);
  });

  it('mesa solo com o dono caído não aceita ninguém', () => {
    const state = mesa(1, [{ id: 'ana', connected: false }]);
    expect(haAssentoLivre(state)).toBe(false);
  });

  it('a contagem não olha `connected` — é o que garante a reserva', () => {
    /**
     * Afirmação redundante de propósito. Se alguém trocar `players.size` por
     * uma contagem de conectados, os casos acima quebram; este explica por quê,
     * para quem só ler a falha.
     */
    const todosCaidos = mesa(2, [
      { id: 'ana', connected: false },
      { id: 'bruno', connected: false },
    ]);
    expect(haAssentoLivre(todosCaidos)).toBe(false);
  });
});

describe('o prazo da janela', () => {
  it('é longo o bastante para reabrir o navegador numa partida de horas', () => {
    /**
     * 90 segundos cobriam um F5 e nada mais. O número exato é discutível; o que
     * este caso trava é a ORDEM DE GRANDEZA — se alguém voltar para segundos,
     * a queixa original volta junto.
     */
    expect(REALTIME_LIMITS.RECONNECTION_WINDOW_S).toBeGreaterThanOrEqual(300);
  });

  it('não é tão longo a ponto de travar uma mesa pública por muito tempo', () => {
    // Quem abandona de vez segura a vaga por todo o prazo. Meia hora seria
    // inviável para uma mesa pública esperando o quarto jogador.
    expect(REALTIME_LIMITS.RECONNECTION_WINDOW_S).toBeLessThanOrEqual(900);
  });
});
