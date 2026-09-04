'use client';

/**
 * useHidratarCosmeticos.ts — traz o equipamento salvo na CONTA.
 *
 * ─── POR QUE ISTO PRECISA SER UM HOOK SEPARADO ─────────────────────────────
 *
 * O store de cosméticos (`cosmetics/store.ts`) lê o `localStorage` no momento
 * em que o módulo é avaliado — é o que faz a mesa abrir já desenhando o sleeve
 * certo, sem esperar rede. Só que o `localStorage` é POR NAVEGADOR: entrar de
 * outra máquina, ou depois de limpar dados do site, começava do padrão.
 *
 * A conta é a fonte da verdade entre dispositivos. Mas ela chega por rede, e
 * uma leitura de rede não pode acontecer na avaliação de um módulo — daí o
 * hook, montado uma vez na casca autenticada.
 *
 * ─── A ORDEM IMPORTA, E O CONFLITO TEM UM VENCEDOR CLARO ───────────────────
 *
 * O cache local aplica primeiro (instantâneo), o servidor corrige depois. Se os
 * dois divergirem, o SERVIDOR vence — ele representa a última escolha
 * deliberada da pessoa, possivelmente feita em outro dispositivo. A exceção é
 * campo nulo no servidor ("nunca escolheu"), que não sobrescreve nada: aí o
 * local é a única informação que existe.
 *
 * Roda uma vez por sessão. Não é uma query que revalida: cosmético muda por
 * ação explícita do dono, e ficar reconciliando por foco de aba faria a mesa
 * piscar de visual no meio de uma partida.
 */

import { useEffect, useRef } from 'react';
import { api } from '../lib/fetcher';
import { useAuthStore } from '../store/auth.store';
import { useCosmeticos } from './store';

interface PreferenciaDaConta {
  preference?: {
    sleeveId?: string | null;
    playmatId?: string | null;
    borderId?: string | null;
    titleId?: string | null;
    petId?: string | null;
    cosmeticosDeOponentes?: boolean | null;
  } | null;
}

export function useHidratarCosmeticos(): void {
  const token = useAuthStore((s) => s.accessToken);
  const aplicarDoServidor = useCosmeticos((s) => s.aplicarDoServidor);
  /**
   * Guarda de execução única.
   *
   * `token` entra nas dependências porque a reidratação do zustand o preenche
   * DEPOIS do primeiro render — sem ele, o efeito rodaria com `null` e
   * desistiria para sempre. Mas com ele, um `logout`/`login` na mesma sessão
   * dispararia de novo, e um re-render qualquer que trocasse a referência do
   * token faria uma requisição a mais. O ref fecha isso.
   */
  const jaBuscou = useRef(false);

  useEffect(() => {
    if (!token || jaBuscou.current) return;
    jaBuscou.current = true;

    let ativo = true;
    void api<PreferenciaDaConta>('/users/me')
      .then((eu) => {
        if (!ativo || !eu?.preference) return;
        const p = eu.preference;
        aplicarDoServidor({
          ...(p.sleeveId ? { sleeveId: p.sleeveId } : {}),
          ...(p.playmatId ? { playmatId: p.playmatId } : {}),
          ...(p.borderId ? { borderId: p.borderId } : {}),
          ...(p.titleId ? { titleId: p.titleId } : {}),
          ...(p.petId ? { petId: p.petId } : {}),
          ...(typeof p.cosmeticosDeOponentes === 'boolean'
            ? { cosmeticosDeOponentes: p.cosmeticosDeOponentes }
            : {}),
        });
      })
      .catch((erro) => {
        /**
         * Falhar aqui é inofensivo, e por isso não vira toast.
         *
         * O jogador segue com o que o `localStorage` tem — que é o visual que
         * ele já estava usando neste navegador. Um aviso de erro sobre
         * cosmético na entrada da taverna seria ruído sobre algo que não
         * impede nada. A próxima sessão tenta de novo.
         */
        console.warn('[cosmeticos] não foi possível hidratar da conta:', erro);
        jaBuscou.current = false;
      });

    return () => {
      ativo = false;
    };
  }, [token, aplicarDoServidor]);
}
