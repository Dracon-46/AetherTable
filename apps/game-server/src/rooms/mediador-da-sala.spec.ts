/**
 * mediador-da-sala.spec.ts — a central sozinha, sem a Room em volta.
 *
 * `ciclo-da-sala.spec.ts` cobre a sala de verdade. Aqui fica o contrato do
 * padrão: cada acontecimento chega aos colegas certos, na ordem certa, e um
 * colega que tem algo a dizer (prazo vencido, sala abandonada) fala com a
 * central — nunca com a Room nem com outro colega.
 */

import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import {
  CentralDaSala,
  DescarteDaSalaVazia,
  PrazosDaMesa,
  RegistroDaPartida,
  Vitrine,
  type Relogio,
} from './mediador-da-sala';

/** Um relógio que só anda quando o teste manda. */
function relogioDeMentira() {
  let timers: { acao: () => void; vivo: boolean }[] = [];
  const relogio: Relogio = {
    setTimeout(acao) {
      const t = { acao, vivo: true };
      timers.push(t);
      return { clear: () => (t.vivo = false) };
    },
  };
  return {
    relogio,
    /** Dispara tudo o que ainda está agendado. */
    vencer() {
      const agora = timers;
      timers = [];
      for (const t of agora) if (t.vivo) t.acao();
    },
  };
}

function jogador(state: RoomState, id: string) {
  const p = new Player();
  p.id = id;
  p.userId = `conta-${id}`;
  state.players.set(id, p);
  return p;
}

function montar(clientes = 0) {
  const state = new RoomState();
  state.visibilidade = 'PUBLICA';
  const { relogio, vencer } = relogioDeMentira();
  const publicados: Record<string, unknown>[] = [];
  const acoes = { encerrarMulliganPorTempo: jest.fn(), descartar: jest.fn() };
  const registro = new RegistroDaPartida(state);
  const central = new CentralDaSala(
    state,
    new Vitrine(state, (m) => publicados.push(m)),
    new DescarteDaSalaVazia(state, relogio, () => clientes),
    new PrazosDaMesa(state, relogio),
    registro,
    acoes,
  );
  return { state, central, registro, publicados, acoes, vencer };
}

describe('CentralDaSala', () => {
  it('quem entra cancela o descarte e a vitrine publica a ocupação nova', () => {
    const { state, central, publicados, acoes, vencer } = montar();
    central.notificar({ tipo: 'SALA_CRIADA' });

    jogador(state, 'a');
    central.notificar({ tipo: 'ENTROU' });
    vencer();

    expect(acoes.descartar).not.toHaveBeenCalled();
    expect(publicados.at(-1)).toMatchObject({ ocupacao: 1, emPartida: false });
  });

  it('a sala que ninguém ocupa é descartada — e o colega avisa a central, não a Room', () => {
    const { central, acoes, vencer } = montar();
    central.notificar({ tipo: 'SALA_CRIADA' });
    vencer();
    expect(acoes.descartar).toHaveBeenCalledTimes(1);
  });

  it('não descarta enquanto houver cliente conectado, mesmo sem assento', () => {
    const { central, acoes, vencer } = montar(1);
    central.notificar({ tipo: 'SAIU' });
    vencer();
    expect(acoes.descartar).not.toHaveBeenCalled();
  });

  it('quem entra com a partida andando também jogou; na sala de espera, ainda não', () => {
    const { state, central, registro } = montar();
    jogador(state, 'a');
    central.notificar({ tipo: 'ENTROU' });
    expect(registro.contasQueJogaram.size).toBe(0);

    state.phase = 'PLAYING';
    jogador(state, 'b');
    central.notificar({ tipo: 'ENTROU' });
    expect(Array.from(registro.contasQueJogaram)).toEqual(['conta-a', 'conta-b']);
  });

  it('intenção que não muda a fase não mexe na vitrine', () => {
    const { state, central, publicados } = montar();
    central.notificar({ tipo: 'INTENCAO_APLICADA', faseAntes: state.phase });
    expect(publicados).toHaveLength(0);
  });

  it('o START_MATCH marca o início, quem começou e "em partida" na vitrine', () => {
    const { state, central, registro, publicados } = montar();
    jogador(state, 'a');
    jogador(state, 'b');
    state.activePlayerId = 'b';
    state.phase = 'PLAYING';

    central.notificar({ tipo: 'INTENCAO_APLICADA', faseAntes: 'WAITING' });

    expect(registro.inicioDaPartida).toBeGreaterThan(0);
    expect(registro.quemComecou).toBe('conta-b');
    expect(registro.augeDeJogadores).toBe(2);
    expect(publicados.at(-1)).toMatchObject({ emPartida: true, ocupacao: 2 });
  });

  it('o prazo do mulligan vencido chega à Room pela central', () => {
    const { state, central, acoes, vencer } = montar();
    jogador(state, 'a');
    state.phase = 'PLAYING';
    state.mulliganExpiraEm = Date.now() - 1;

    central.notificar({ tipo: 'INTENCAO_APLICADA', faseAntes: 'PLAYING' });
    vencer();

    expect(acoes.encerrarMulliganPorTempo).toHaveBeenCalledTimes(1);
  });

  it('a votação vencida é fechada pelo próprio colega', () => {
    const { state, central, vencer } = montar();
    state.votacaoAlvo = 'c';
    state.votacaoAutor = 'a';
    state.votacaoExpiraEm = Date.now() - 1;

    central.notificar({ tipo: 'INTENCAO_APLICADA', faseAntes: state.phase });
    vencer();

    expect(state.votacaoAlvo).toBe('');
    expect(state.votacaoAutor).toBe('');
  });

  it('sala privada some da lista: a vitrine só diz que é privada', () => {
    const { state, central, publicados } = montar();
    state.visibilidade = 'PRIVADA';
    central.notificar({ tipo: 'SALA_CONFIGURADA' });
    expect(publicados).toEqual([{ visibilidade: 'PRIVADA' }]);
  });
});
