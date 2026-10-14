'use client';

/**
 * efeitos.ts — som e tremor da mesa, as duas preferências "de sentir".
 *
 * ─── POR QUE SINTETIZAR EM VEZ DE TOCAR ARQUIVO ────────────────────────────
 *
 * O projeto não carrega asset de terceiros (os cosméticos são procedurais pelo
 * mesmo motivo), e um tom de 80 ms não justifica um MP3 com licença, cache e
 * requisição. A Web Audio gera o bipe na hora, offline, sem nada a baixar.
 *
 * ─── POR QUE OUVIR OS STORES, E NÃO OS EVENTOS DA SALA ─────────────────────
 *
 * O dado, a moeda e a reação já chegam ao `tableStore` pelo `useRoomSync`.
 * Assinar o store aqui mantém o som num lugar só e deixa o `useRoomSync`
 * fazendo uma coisa: espelhar o servidor. Desligar a preferência é só não
 * tocar — nenhuma assinatura de rede muda.
 */

import { useEffect } from 'react';
import { useGameStore, useTableStore, useUIStore } from '../store/game.store';

type Som = 'DADO' | 'MOEDA' | 'REACAO' | 'SUA_VEZ';

let audio: AudioContext | null = null;

/** Um tom curto com envelope, para não estalar no começo nem no fim. */
function tom(
  freq: number,
  inicio: number,
  duracao: number,
  volume = 0.05,
  forma: OscillatorType = 'sine',
) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const ganho = audio.createGain();
  osc.type = forma;
  osc.frequency.value = freq;
  const t0 = audio.currentTime + inicio;
  ganho.gain.setValueAtTime(0, t0);
  ganho.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
  osc.connect(ganho).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duracao + 0.02);
}

export function tocar(som: Som): void {
  try {
    // O contexto só nasce no primeiro som: navegadores bloqueiam áudio antes
    // de um gesto do usuário, e criar cedo deixaria o contexto suspenso.
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    return;
  }
  switch (som) {
    case 'DADO':
      // Três batidas secas, como o dado quicando na mesa.
      tom(420, 0, 0.05, 0.05, 'triangle');
      tom(360, 0.07, 0.05, 0.04, 'triangle');
      tom(300, 0.15, 0.08, 0.035, 'triangle');
      break;
    case 'MOEDA':
      tom(1320, 0, 0.12, 0.035);
      tom(1760, 0.06, 0.18, 0.03);
      break;
    case 'REACAO':
      tom(660, 0, 0.09, 0.03);
      break;
    case 'SUA_VEZ':
      tom(523, 0, 0.14, 0.05);
      tom(784, 0.12, 0.22, 0.05);
      break;
  }
}

/** Liga os efeitos à mesa. Montado uma vez, na página da partida. */
export function useEfeitosDaMesa(): void {
  useEffect(() => {
    const ligadoSom = () => useUIStore.getState().efeitosSonoros;

    const semSorteio = useTableStore.subscribe((s, antes) => {
      const atual = s.ultimoSorteio;
      if (!atual || atual.em === antes.ultimoSorteio?.em || !ligadoSom()) return;
      tocar(atual.tipo === 'DADO' ? 'DADO' : 'MOEDA');
    });

    const semReacao = useTableStore.subscribe((s, antes) => {
      if (s.reacoes.length === 0 || !ligadoSom()) return;
      const nova = s.reacoes[s.reacoes.length - 1];
      const anterior = antes.reacoes[antes.reacoes.length - 1];
      if (nova && nova.id !== anterior?.id) tocar('REACAO');
    });

    const semVez = useGameStore.subscribe((s, antes) => {
      if (!ligadoSom()) return;
      if (
        s.activePlayerId &&
        s.activePlayerId !== antes.activePlayerId &&
        s.activePlayerId === s.mySessionId
      ) {
        tocar('SUA_VEZ');
      }
    });

    /**
     * ─── O TREMOR OLHA A TRANSIÇÃO, NÃO O ESTADO ──────────────────────────
     *
     * "Há um comandante no campo" é verdade o turno inteiro; o tremor é do
     * INSTANTE em que ele entra. Por isso a comparação é com o estado anterior
     * da mesma carta: só a passagem para BATTLEFIELD dispara.
     */
    const semTremor = useGameStore.subscribe((s, antes) => {
      if (!useUIStore.getState().tremorDoComandante || s.cards === antes.cards) return;
      const entrou = Object.values(s.cards).some(
        (c) =>
          c.isCommander &&
          c.zone === 'BATTLEFIELD' &&
          antes.cards[c.id] &&
          antes.cards[c.id]!.zone !== 'BATTLEFIELD',
      );
      if (!entrou) return;
      const corpo = document.body;
      corpo.classList.remove('animate-terremoto');
      // Forçar o reflow reinicia a animação se dois comandantes entrarem
      // seguidos — sem isto, o segundo não tremeria.
      void corpo.offsetWidth;
      corpo.classList.add('animate-terremoto');
      window.setTimeout(() => corpo.classList.remove('animate-terremoto'), 800);
    });

    return () => {
      semSorteio();
      semReacao();
      semVez();
      semTremor();
    };
  }, []);
}
