'use client';

/**
 * progresso.ts — o recorde e a sequência de cada desafio, na CONTA.
 *
 * ─── O QUE ESTAVA ACONTECENDO ──────────────────────────────────────────────
 *
 * O recorde ficava no `localStorage` (`aethertable:desafio:<chave>`) e a
 * sequência num `useState` de cada desafio: trocar de PC zerava o recorde, e
 * até um F5 zerava a sequência. "A sequência de vitórias tem que seguir a
 * conta." Agora as duas moram em `progresso_de_desafios`, pela API
 * (`/users/me/desafios`).
 *
 * ─── A REGRA DA PERGUNTA ABANDONADA ────────────────────────────────────────
 *
 * Com a sequência sobrevivendo ao F5, recarregar a página virou um jeito de
 * PULAR pergunta difícil: a carta nova vinha e a sequência continuava lá. Por
 * isso cada desafio avisa a conta quando uma pergunta COMEÇA
 * (`comecarPergunta`: `emJogo: true`) e quando é RESPONDIDA (`responder`:
 * `emJogo: false`). Ao abrir um desafio cuja conta diz `emJogo: true`, a
 * pergunta anterior ficou sem resposta — F5, aba fechada, troca de aba de
 * desafio, outro PC — e a sequência zera antes de começar, exatamente como se
 * a pessoa tivesse errado. Sem isso, a sequência na conta valeria menos que a
 * do `useState`, que pelo menos não deixava pular.
 *
 * ─── UMA CARGA POR CONTA, E O RECORDE ANTIGO SOBE UMA VEZ ──────────────────
 *
 * Os cinco desafios dividem um mapa só (`GET /users/me/desafios`), pedido uma
 * vez por conta e mantido aqui. Na primeira carga deste navegador, os
 * recordes que ele guardava no formato antigo sobem pela importação
 * (`max(conta, navegador)` no servidor) e as chaves antigas são apagadas.
 * Se a importação falhar — rede, ou a API ainda na versão antiga —, nada é
 * apagado: o recorde local continua aparecendo e a próxima carga tenta de
 * novo.
 */

import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  ehChaveDeDesafio,
  MAX_DESAFIOS_POR_CONTA,
  normalizarPlacar,
  normalizarProgressoDosDesafios,
  type ProgressoDeDesafio,
  type ProgressoDosDesafios,
} from '@aethertable/shared-types';
import { api } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';

/** Onde o recorde morava antes de ir para a conta. */
export const PREFIXO_ANTIGO = 'aethertable:desafio:';

const VAZIO: ProgressoDeDesafio = { recorde: 0, sequencia: 0, emJogo: false };

export const useProgressoDosDesafios = create<{ mapa: ProgressoDosDesafios }>(() => ({
  mapa: {},
}));

// ─── O QUE O NAVEGADOR GUARDAVA ────────────────────────────────────────────────

interface RecordesAntigos {
  /** `{ [chave]: recorde }` dos que valem a pena subir. */
  recordes: Record<string, number>;
  /** Todas as chaves antigas do `localStorage`, para apagar depois. */
  chaves: string[];
}

function lerRecordesAntigos(): RecordesAntigos {
  const saida: RecordesAntigos = { recordes: {}, chaves: [] };
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k?.startsWith(PREFIXO_ANTIGO)) continue;
      saida.chaves.push(k);
      const chave = k.slice(PREFIXO_ANTIGO.length);
      const recorde = normalizarPlacar(Number(ls.getItem(k)));
      if (
        ehChaveDeDesafio(chave) &&
        recorde > 0 &&
        Object.keys(saida.recordes).length < MAX_DESAFIOS_POR_CONTA
      ) {
        saida.recordes[chave] = recorde;
      }
    }
  } catch {
    /* sem armazenamento: não há o que subir */
  }
  return saida;
}

function apagarRecordesAntigos(chaves: string[]): void {
  try {
    for (const k of chaves) window.localStorage.removeItem(k);
  } catch {
    /* fica para a próxima carga; a importação é idempotente */
  }
}

/** O recorde de cada lado, o maior. Para quando a importação não pôde subir. */
function comRecordesLocais(
  mapa: ProgressoDosDesafios,
  recordes: Record<string, number>,
): ProgressoDosDesafios {
  const saida = { ...mapa };
  for (const [chave, recorde] of Object.entries(recordes)) {
    const atual = saida[chave] ?? VAZIO;
    saida[chave] = { ...atual, recorde: Math.max(atual.recorde, recorde) };
  }
  return saida;
}

// ─── A CARGA ───────────────────────────────────────────────────────────────────

/** Nunca rejeita: sem a conta, o desafio funciona com o que o navegador tem. */
async function buscarDaConta(): Promise<ProgressoDosDesafios> {
  const antigos = lerRecordesAntigos();
  if (Object.keys(antigos.recordes).length > 0) {
    try {
      const mapa = await api<unknown>('/users/me/desafios/importar', {
        method: 'POST',
        body: antigos.recordes,
      });
      // Só agora, com o recorde já na conta: uma vez por navegador.
      apagarRecordesAntigos(antigos.chaves);
      return normalizarProgressoDosDesafios(mapa);
    } catch (erro) {
      console.warn('[desafios] não foi possível subir o recorde deste navegador:', erro);
      const mapa = await api<unknown>('/users/me/desafios').catch(() => ({}));
      return comRecordesLocais(normalizarProgressoDosDesafios(mapa), antigos.recordes);
    }
  }
  // Chave antiga sem recorde que valha subir (zero, formato estranho): lixo.
  if (antigos.chaves.length > 0) apagarRecordesAntigos(antigos.chaves);
  try {
    return normalizarProgressoDosDesafios(await api<unknown>('/users/me/desafios'));
  } catch (erro) {
    console.warn('[desafios] não foi possível ler o progresso da conta:', erro);
    return {};
  }
}

let carga: { dono: string; promessa: Promise<void> } | null = null;

/**
 * Traz o progresso da conta, uma vez por conta. Sem sessão, só o que o
 * navegador guardava (e nada sobe).
 */
export function carregarProgresso(): Promise<void> {
  const { accessToken, user } = useAuthStore.getState();
  const dono = accessToken ? (user?.id ?? accessToken) : '';
  if (carga?.dono === dono) return carga.promessa;

  const promessa = (
    accessToken
      ? buscarDaConta()
      : Promise.resolve(comRecordesLocais({}, lerRecordesAntigos().recordes))
  ).then((mapa) => {
    // Trocou de conta enquanto a resposta vinha: ela não é desta.
    if (carga?.dono === dono) useProgressoDosDesafios.setState({ mapa });
  });
  carga = { dono, promessa };
  return promessa;
}

// ─── A ESCRITA ─────────────────────────────────────────────────────────────────

/**
 * Um `PUT` por vez para cada desafio, na ordem em que aconteceram.
 *
 * "Sorteei" e "respondi" saem com segundos de distância, mas são duas
 * requisições independentes: sem a fila, uma rede lenta poderia entregar o
 * "sorteei" (`emJogo: true`) DEPOIS do "respondi", e a conta ficaria com uma
 * pergunta aberta que a pessoa já respondeu — e a próxima carga zeraria a
 * sequência dela sem motivo.
 */
const filas = new Map<string, Promise<void>>();

function enviar(chave: string, corpo: { sequencia: number; emJogo: boolean }): void {
  if (!useAuthStore.getState().accessToken) return;
  const anterior = filas.get(chave) ?? Promise.resolve();
  const proxima = anterior
    .then(() =>
      api<unknown>(`/users/me/desafios/${encodeURIComponent(chave)}`, {
        method: 'PUT',
        body: corpo,
      }),
    )
    .then((resposta) => {
      // A conta pode ter um recorde MAIOR (feito em outra máquina): vale o maior.
      const daConta = normalizarPlacar((resposta as { recorde?: unknown } | null)?.recorde);
      useProgressoDosDesafios.setState((s) => {
        const atual = s.mapa[chave] ?? VAZIO;
        return daConta > atual.recorde
          ? { mapa: { ...s.mapa, [chave]: { ...atual, recorde: daConta } } }
          : s;
      });
    })
    .catch((erro) => {
      // Falhar NÃO desfaz a jogada: a tela já mostra o placar novo, e a
      // próxima resposta leva a sequência (e o recorde) junto.
      console.warn('[desafios] não foi possível salvar o progresso na conta:', erro);
    });
  filas.set(chave, proxima);
}

/** Muda o progresso local na hora e manda para a conta. O recorde só sobe. */
function registrar(chave: string, mudanca: { sequencia?: number; emJogo: boolean }): void {
  const anterior = useProgressoDosDesafios.getState().mapa[chave] ?? VAZIO;
  const sequencia = mudanca.sequencia ?? anterior.sequencia;
  const novo: ProgressoDeDesafio = {
    recorde: Math.max(anterior.recorde, sequencia),
    sequencia,
    emJogo: mudanca.emJogo,
  };
  useProgressoDosDesafios.setState((s) => ({ mapa: { ...s.mapa, [chave]: novo } }));
  enviar(chave, { sequencia, emJogo: mudanca.emJogo });
}

/**
 * Prepara um desafio para começar: espera a carga e aplica a regra da
 * pergunta abandonada (ver o cabeçalho).
 */
export async function abrirDesafio(chave: string): Promise<void> {
  await carregarProgresso();
  if (useProgressoDosDesafios.getState().mapa[chave]?.emJogo) {
    registrar(chave, { sequencia: 0, emJogo: false });
  }
}

/** Só para os testes: esquece a carga, as filas e o mapa. */
export function reiniciarProgressoDosDesafios(): void {
  carga = null;
  filas.clear();
  useProgressoDosDesafios.setState({ mapa: {} });
}

// ─── O HOOK ────────────────────────────────────────────────────────────────────

export interface ProgressoNaTela {
  recorde: number;
  sequencia: number;
  /**
   * A carga chegou e a regra da pergunta abandonada já foi aplicada. Antes
   * disso o desafio não deixa jogar: uma resposta dada sobre a sequência
   * ainda não carregada seria sobrescrita por ela.
   */
  pronto: boolean;
  /** A pergunta apareceu na tela: a conta passa a saber que há uma aberta. */
  comecarPergunta: () => void;
  /** A pergunta foi respondida: a sequência nova (0 quando errou). */
  responder: (sequencia: number) => void;
}

export function useProgressoDeDesafio(chave: string): ProgressoNaTela {
  const progresso = useProgressoDosDesafios((s) => s.mapa[chave] ?? VAZIO);
  /** A chave já aberta NESTA montagem. Trocar de chave volta a esperar. */
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    void abrirDesafio(chave).then(() => {
      if (ativo) setAberta(chave);
    });
    return () => {
      ativo = false;
    };
  }, [chave]);

  const comecarPergunta = useCallback(() => registrar(chave, { emJogo: true }), [chave]);
  const responder = useCallback(
    (sequencia: number) => registrar(chave, { sequencia, emJogo: false }),
    [chave],
  );

  return {
    recorde: progresso.recorde,
    sequencia: progresso.sequencia,
    pronto: aberta === chave,
    comecarPergunta,
    responder,
  };
}
