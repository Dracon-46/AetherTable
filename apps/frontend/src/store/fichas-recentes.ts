'use client';

/**
 * fichas-recentes.ts — o "Usadas recentemente" do seletor de fichas, na conta.
 *
 * ─── O QUE MUDOU ───────────────────────────────────────────────────────────
 *
 * A lista vivia só no `localStorage` (`aether-fichas-recentes`). Quem joga com
 * fichas cria as MESMAS a partida inteira, e trocar de máquina esvaziava a
 * fileira justamente na partida em que ela mais ajudava. Agora ela mora em
 * `user_preferences.fichas_recentes`, e o `localStorage` continua sendo o
 * cache — a mesma chave e o mesmo formato de antes, para o navegador não
 * perder o que já tinha.
 *
 * ─── A PRIMEIRA HIDRATAÇÃO MESCLA, NÃO SUBSTITUI ───────────────────────────
 *
 * A lista da conta vem primeiro (é a fonte da verdade entre máquinas), e o
 * que só este navegador tinha entra depois, sem repetir. Substituir jogaria
 * fora, na primeira entrada depois desta versão, a lista que o navegador
 * juntou antes de ela existir na conta. Se a mescla ficou diferente do que a
 * conta tinha, ela sobe.
 *
 * Por que um store, e não só funções sobre o `localStorage`: o envio para a
 * conta é a mesma assinatura com espera das outras preferências
 * (`observarComEspera`), e ela assina um store. Criar cinco Tesouros seguidos
 * vira um PATCH, não cinco.
 */

import { create } from 'zustand';
import { mesmaFicha, normalizarFichasRecentes, type FichaRecente } from '@aethertable/shared-types';
import { observarComEspera, type OpcoesDeObservacao } from './preferencias-da-conta';

const CHAVE = 'aether-fichas-recentes';
/** Quantas o seletor mostra — e guarda. A conta aceita até 12 (`MAX_FICHAS_RECENTES`). */
export const MAX_RECENTES = 8;

export type { FichaRecente };

function lerDoNavegador(): FichaRecente[] {
  try {
    const bruto: unknown = JSON.parse(window.localStorage.getItem(CHAVE) ?? '[]');
    return normalizarFichasRecentes(bruto, MAX_RECENTES);
  } catch {
    return [];
  }
}

function gravarNoNavegador(lista: FichaRecente[]): void {
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    /* sem storage: a lista só não sobrevive ao recarregar (a conta ainda guarda) */
  }
}

const useFichasRecentes = create<{ lista: FichaRecente[]; carregada: boolean }>(() => ({
  lista: [],
  carregada: false,
}));

/**
 * Lê o cache local na PRIMEIRA vez que alguém precisa, e não na avaliação do
 * módulo: o módulo também é avaliado no servidor, onde não há `localStorage`.
 */
function garantirCarga(): FichaRecente[] {
  const { lista, carregada } = useFichasRecentes.getState();
  if (carregada || typeof window === 'undefined') return lista;
  const doNavegador = lerDoNavegador();
  useFichasRecentes.setState({ lista: doNavegador, carregada: true });
  return doNavegador;
}

/** A lista para desenhar, a mais recente primeiro. */
export function lerFichasRecentes(): FichaRecente[] {
  return garantirCarga();
}

/** Põe a ficha no topo (sem repetir), guarda e devolve a lista nova. */
export function lembrarFichaRecente(f: FichaRecente): FichaRecente[] {
  const atual = garantirCarga();
  const nova = normalizarFichasRecentes(
    [f, ...atual.filter((a) => !mesmaFicha(a, f))],
    MAX_RECENTES,
  );
  useFichasRecentes.setState({ lista: nova, carregada: true });
  gravarNoNavegador(nova);
  return nova;
}

/**
 * Mescla a lista da conta com a deste navegador e diz se a mescla precisa
 * subir. Ausente na resposta (API antiga) é lista vazia: o local fica, e sobe.
 */
export function aplicarFichasRecentesDaConta(daConta: unknown): boolean {
  const local = garantirCarga();
  const conta = normalizarFichasRecentes(daConta, MAX_RECENTES);
  const mescla = normalizarFichasRecentes([...conta, ...local], MAX_RECENTES);
  useFichasRecentes.setState({ lista: mescla, carregada: true });
  gravarNoNavegador(mescla);
  return JSON.stringify(mescla) !== JSON.stringify(conta);
}

/** Passa a mandar a lista para a conta a cada ficha criada. Ver `observarComEspera`. */
export function observarFichasRecentes(opcoes?: OpcoesDeObservacao): () => void {
  return observarComEspera(
    {
      assinar: useFichasRecentes.subscribe,
      mudou: (estado, anterior) => estado.lista !== anterior.lista,
      corpo: () => ({ fichasRecentes: useFichasRecentes.getState().lista }),
      rotulo: 'as fichas recentes',
    },
    opcoes,
  );
}

/** Só para os testes: volta ao estado de antes da primeira leitura. */
export function reiniciarFichasRecentes(): void {
  useFichasRecentes.setState({ lista: [], carregada: false });
}
