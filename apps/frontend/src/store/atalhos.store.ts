'use client';

/**
 * atalhos.store.ts — que tecla aciona qual ação, por conta.
 *
 * ─── A COLUNA JÁ EXISTIA E NINGUÉM ESCREVIA NELA ───────────────────────────
 *
 * `user_preferences.keybindings` está no Prisma desde a primeira migração, com
 * um comentário explicando por que é JSONB — "o conjunto de ações mapeáveis
 * muda a cada versão" — e nunca foi lida nem escrita por lugar nenhum do
 * código. O esquema previa atalhos remapeáveis; o produto não os tinha.
 *
 * ─── MESMO DESENHO DOS COSMÉTICOS, E PELO MESMO MOTIVO ─────────────────────
 *
 * `localStorage` é CACHE, a conta é a fonte da verdade. A mesa não pode esperar
 * um round-trip de API para saber que tecla compra uma carta: o listener de
 * teclado é montado no primeiro render, e um atalho que só funciona depois de a
 * rede responder é um atalho que falha exatamente nos primeiros segundos, quando
 * o jogador está arrumando a mão.
 *
 * A gravação é OTIMISTA: remapear aplica na hora e o PATCH sai atrás. Falha de
 * rede não desfaz o remapeamento na tela — o `localStorage` já guardou, e a
 * próxima hidratação bem-sucedida reconcilia.
 *
 * ─── O MAPA INTEIRO VAI PARA O SERVIDOR, NÃO SÓ O QUE MUDOU ────────────────
 *
 * Gravar apenas o diff contra o padrão economizaria bytes e criaria uma
 * ambiguidade: uma chave ausente significaria "quero o padrão" ou "esta ação é
 * nova e eu nunca vi"? São treze entradas. Mandar tudo faz o PATCH ser
 * idempotente e a leitura não precisar de heurística — `resolverAtalhos`
 * completa com o padrão o que faltar, e é assim que uma ação NOVA numa versão
 * futura chega com tecla de fábrica em vez de chegar desligada.
 */

import { create } from 'zustand';
import {
  ATALHOS_PADRAO,
  TECLA_NAO_ATRIBUIDA,
  ehTeclaDeAtalho,
  resolverAtalhos,
  type AcaoDeAtalho,
} from '@aethertable/shared-types';
import { api } from '../lib/fetcher';

const CHAVE = 'aether-atalhos-v1';

type Mapa = Record<AcaoDeAtalho, string>;

interface AtalhosState {
  atalhos: Mapa;
  /** Grava a tecla nova. Passar `TECLA_NAO_ATRIBUIDA` desliga a ação. */
  remapear: (acao: AcaoDeAtalho, tecla: string) => void;
  /** Devolve as treze ações às teclas de fábrica. */
  restaurarPadrao: () => void;
  /** Aplica o que veio da conta, sem reenviar. Ver `useHidratarPreferencias`. */
  aplicarDoServidor: (salvos: Record<string, string> | null | undefined) => void;
}

/**
 * Envia o mapa ao servidor, e engole a falha.
 *
 * Um erro aqui NÃO pode desfazer o remapeamento: o `localStorage` já guardou, o
 * listener já está usando a tecla nova, e transformar uma queda de rede em "o
 * atalho voltou sozinho" é pior do que ficar dessincronizado até a próxima
 * hidratação. O `console.warn` deixa rastro para quem investigar.
 */
function salvarNaConta(atalhos: Mapa): void {
  void api('/users/me', { method: 'PATCH', body: { keybindings: atalhos } }).catch((erro) => {
    console.warn('[atalhos] não foi possível salvar na conta:', erro);
  });
}

function ler(): Mapa {
  if (typeof window === 'undefined') return { ...ATALHOS_PADRAO };
  try {
    const cru = window.localStorage.getItem(CHAVE);
    // Passa pelo `resolverAtalhos` mesmo vindo do cache local: um mapa gravado
    // por uma versão anterior pode ter ação que não existe mais, e uma ação
    // nova não está lá.
    return resolverAtalhos(cru ? (JSON.parse(cru) as Record<string, string>) : null);
  } catch {
    return { ...ATALHOS_PADRAO };
  }
}

function gravar(atalhos: Mapa): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAVE, JSON.stringify(atalhos));
  } catch {
    /* cota cheia ou aba privada: vale só nesta sessão */
  }
}

export const useAtalhos = create<AtalhosState>((set, get) => ({
  atalhos: ler(),

  remapear: (acao, tecla) => {
    if (tecla !== TECLA_NAO_ATRIBUIDA && !ehTeclaDeAtalho(tecla)) return;

    /**
     * ─── UMA TECLA, UMA AÇÃO ─────────────────────────────────────────────
     *
     * Tomar a tecla de quem a tinha é feito AQUI, e não deixado para o
     * `acaoDaTecla` resolver por ordem de catálogo. Duas ações na mesma tecla
     * produzem um atalho cuja função depende da ordem de uma constante — o
     * jogador aperta 'g' esperando cemitério e a carta transforma.
     *
     * Quem perde a tecla fica SEM tecla, e não com a tecla antiga da ação que
     * acabou de mudar: uma troca em cadeia ("agora 'g' faz o que 't' fazia")
     * é inventar uma intenção que ninguém expressou.
     */
    const atalhos = { ...get().atalhos, [acao]: tecla } as Mapa;
    if (tecla !== TECLA_NAO_ATRIBUIDA) {
      for (const id of Object.keys(atalhos) as AcaoDeAtalho[]) {
        if (id !== acao && atalhos[id] === tecla) atalhos[id] = TECLA_NAO_ATRIBUIDA;
      }
    }

    set({ atalhos });
    gravar(atalhos);
    salvarNaConta(atalhos);
  },

  restaurarPadrao: () => {
    const atalhos = { ...ATALHOS_PADRAO } as Mapa;
    set({ atalhos });
    gravar(atalhos);
    salvarNaConta(atalhos);
  },

  aplicarDoServidor: (salvos) => {
    // `{}` no banco é o valor de fábrica da coluna e significa "nunca
    // remapeou" — não pode sobrescrever o que este navegador tem, senão
    // remapear numa aba e recarregar outra devolveria tudo ao padrão.
    if (!salvos || Object.keys(salvos).length === 0) return;
    const atalhos = resolverAtalhos(salvos);
    set({ atalhos });
    gravar(atalhos);
  },
}));
