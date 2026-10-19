'use client';

/**
 * useNotificacoes.ts — os avisos do sino e o que já foi visto.
 *
 * Os avisos vêm do servidor (`GET /notificacoes`, derivados de curtidas e
 * denúncias). O "já vi" — a data da última vez que o sino foi aberto e a
 * última versão de Novidades lida — segue a CONTA (`/notificacoes/leitura`),
 * com o `localStorage` como cache.
 *
 * ─── POR QUE O "JÁ VI" FOI PARA A CONTA ────────────────────────────────────
 *
 * Era só deste navegador, e em outra máquina tudo acendia como novo: o mesmo
 * aviso lido no notebook voltava a contar no PC de casa. O cache local
 * continua, porque o número do sino aparece antes de a rede responder e
 * porque, sem conta alcançável (API fora, aba anônima), o pior que acontece é
 * o sino acender de novo — nunca um erro.
 *
 * ─── O MAIOR VENCE, NOS DOIS SENTIDOS ──────────────────────────────────────
 *
 * Ler é monotônico: o que foi visto em qualquer lugar está visto. Por isso a
 * mescla entre o navegador e a conta não tem "quem ganha" — vale a data MAIS
 * TARDE das duas, e a Novidade atual se qualquer uma das duas já a leu. Se o
 * navegador sabia mais que a conta (a primeira entrada depois desta versão, ou
 * uma marcação que não chegou por falta de rede), ele sobe.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { LeituraDoSino } from '@aethertable/shared-types';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/fetcher';
import { NOVIDADE_MAIS_RECENTE } from '../novidades/novidades';

export type Notificacao =
  | { tipo: 'CURTIDAS'; em: string; deckId: string; nomeDoDeck: string; quantas: number }
  | { tipo: 'COMENTARIOS'; em: string; deckId: string; nomeDoDeck: string; quantos: number }
  | {
      tipo: 'DENUNCIA_ANALISADA';
      em: string;
      denunciaId: string;
      desfecho: 'RESOLVED' | 'DISMISSED';
    };

const CHAVE_VISTO_EM = 'aethertable:sino-visto-em';
const CHAVE_VERSAO_VISTA = 'aethertable:novidade-vista';

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem armazenamento, o sino só volta a acender */
  }
}

export function useNotificacoes() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['notificacoes'],
    queryFn: ({ signal }) => api<Notificacao[]>('/notificacoes', { signal }),
    enabled: Boolean(token),
    staleTime: 60_000,
    // Curtida não é urgente: de cinco em cinco minutos basta.
    refetchInterval: 5 * 60_000,
  });
}

/** A data mais tarde das duas (ISO), comparada como instante e não como texto. */
function maisTarde(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** A versão lida: a atual, se qualquer um dos lados já a leu. */
function versaoLida(local: string | null, conta: string | null): string | null {
  const atual = NOVIDADE_MAIS_RECENTE.versao;
  if (local === atual || conta === atual) return atual;
  return local ?? conta;
}

/**
 * Manda a leitura para a conta. Falhar não desfaz nada na tela: o cache local
 * já guardou, e a próxima abertura do sino (ou a próxima entrada) tenta de
 * novo. A resposta traz o que ficou na conta — que pode ser MAIS TARDE, se
 * outra máquina marcou depois —, e a mescla é aplicada aqui também.
 */
function enviarLeitura(vistoEm: string, novidadeVista: string): void {
  if (!useAuthStore.getState().accessToken) return;
  void api<LeituraDoSino>('/notificacoes/leitura', {
    method: 'PUT',
    body: { vistoEm, novidadeVista },
  })
    .then((conta) => useSinoStore.getState().mesclar(conta))
    .catch((erro) => {
      console.warn('[sino] não foi possível salvar a leitura na conta:', erro);
    });
}

/**
 * O "já vi", num store: há mais de um sino montado (cabeçalho do celular, menu
 * aberto, menu recolhido), e abrir um precisa apagar o número dos outros.
 *
 * É também o que garante UMA busca da leitura da conta por sessão, por mais
 * sinos que estejam montados: `contaBuscada` guarda de qual sessão ela já foi
 * pedida.
 */
interface EstadoDoSino {
  vistoEm: string | null;
  versaoVista: string | null;
  carregado: boolean;
  /** O token da sessão cuja leitura já foi pedida. Ver `sincronizarComConta`. */
  contaBuscada: string | null;
  carregar: () => void;
  /** Busca a leitura da conta, uma vez por sessão, e mescla com a local. */
  sincronizarComConta: (token: string) => void;
  /** Aplica uma leitura vinda da conta: o maior de cada lado. */
  mesclar: (conta: Partial<LeituraDoSino> | null | undefined) => void;
  marcar: (maisRecente?: string) => void;
}

export const useSinoStore = create<EstadoDoSino>((set, get) => ({
  vistoEm: null,
  versaoVista: null,
  carregado: false,
  contaBuscada: null,
  carregar: () => {
    if (get().carregado) return;
    set({ vistoEm: ler(CHAVE_VISTO_EM), versaoVista: ler(CHAVE_VERSAO_VISTA), carregado: true });
  },
  sincronizarComConta: (token) => {
    if (get().contaBuscada === token) return;
    set({ contaBuscada: token });
    get().carregar();
    void api<LeituraDoSino>('/notificacoes/leitura')
      .then((conta) => {
        // Trocou de sessão enquanto a resposta vinha: ela é da conta anterior.
        if (get().contaBuscada !== token) return;
        get().mesclar(conta);
        /**
         * O navegador sabia mais que a conta: sobe. Acontece na primeira
         * entrada depois desta versão (o "já vi" só existia aqui) e quando uma
         * marcação anterior não chegou por falta de rede.
         */
        const { vistoEm, versaoVista } = get();
        const contaSabe =
          Date.parse(conta?.vistoEm ?? '') === Date.parse(vistoEm ?? '') &&
          conta?.novidadeVista === versaoVista;
        if (vistoEm && versaoVista && !contaSabe) enviarLeitura(vistoEm, versaoVista);
      })
      .catch((erro) => {
        // Sem a conta (rede, ou a API ainda na versão antiga), o sino segue
        // com o que o navegador tem. Não é erro de tela.
        console.warn('[sino] não foi possível ler a leitura da conta:', erro);
      });
  },
  mesclar: (conta) => {
    const vistoEm = maisTarde(get().vistoEm, conta?.vistoEm ?? null);
    const versaoVista = versaoLida(get().versaoVista, conta?.novidadeVista ?? null);
    if (vistoEm) gravar(CHAVE_VISTO_EM, vistoEm);
    if (versaoVista) gravar(CHAVE_VERSAO_VISTA, versaoVista);
    set({ vistoEm, versaoVista });
  },
  marcar: (maisRecente) => {
    // O mais tarde entre o relógio daqui e o aviso mais novo: com o relógio do
    // aparelho atrasado em relação ao servidor, o aviso que acabou de chegar
    // continuaria "novo" depois de o sino ser aberto.
    const relogio = new Date().toISOString();
    const agora = maisRecente && maisRecente > relogio ? maisRecente : relogio;
    gravar(CHAVE_VISTO_EM, agora);
    gravar(CHAVE_VERSAO_VISTA, NOVIDADE_MAIS_RECENTE.versao);
    set({ vistoEm: agora, versaoVista: NOVIDADE_MAIS_RECENTE.versao });
    enviarLeitura(agora, NOVIDADE_MAIS_RECENTE.versao);
  },
}));

/** O que está por ler, e como marcar tudo como lido. */
export function useNaoLidas(notificacoes: Notificacao[] | undefined) {
  const { vistoEm, versaoVista, carregado, carregar, sincronizarComConta, marcar } = useSinoStore();
  const token = useAuthStore((s) => s.accessToken);

  // Lido no efeito, não no render: no servidor não há `localStorage`, e o
  // primeiro render do cliente precisa bater com o do servidor.
  useEffect(carregar, [carregar]);

  // Cada sino montado pede; o store busca uma vez por sessão.
  useEffect(() => {
    if (token) sincronizarComConta(token);
  }, [token, sincronizarComConta]);

  const avisosNovos = carregado
    ? (notificacoes ?? []).filter((n) => !vistoEm || n.em > vistoEm).length
    : 0;
  const novidadeNova = carregado && versaoVista !== NOVIDADE_MAIS_RECENTE.versao;

  return {
    total: avisosNovos + (novidadeNova ? 1 : 0),
    novidadeNova,
    /** A data de corte ANTES de marcar — para destacar o que era novo ao abrir. */
    vistoEm,
    marcarComoLido: () =>
      marcar(
        (notificacoes ?? []).reduce<string | undefined>(
          (m, n) => (!m || n.em > m ? n.em : m),
          undefined,
        ),
      ),
  };
}
