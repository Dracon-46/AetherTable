'use client';

/**
 * useHidratarPreferencias.ts — traz da CONTA tudo que vive em
 * `user_preferences`.
 *
 * ─── POR QUE ISTO PRECISA SER UM HOOK, E UM SÓ ─────────────────────────────
 *
 * Os stores de cosméticos e de atalhos leem o `localStorage` no momento em que
 * o módulo é avaliado — é o que faz a mesa abrir já desenhando o sleeve certo e
 * o teclado já respondendo à tecla remapeada, sem esperar rede. Só que o
 * `localStorage` é POR NAVEGADOR: entrar de outra máquina, ou depois de limpar
 * dados do site, começava do padrão.
 *
 * A conta é a fonte da verdade entre dispositivos. Mas ela chega por rede, e
 * uma leitura de rede não pode acontecer na avaliação de um módulo — daí o
 * hook, montado uma vez na casca autenticada.
 *
 * Este arquivo substitui o `useHidratarCosmeticos`, que fazia exatamente isto
 * para os cosméticos. Os atalhos moram na MESMA linha de `user_preferences` e
 * chegam no MESMO `GET /users/me`: dois hooks seriam duas requisições
 * idênticas, e a segunda existiria só porque o nome do primeiro tinha ficado
 * estreito.
 *
 * ─── A ORDEM IMPORTA, E O CONFLITO TEM UM VENCEDOR CLARO ───────────────────
 *
 * O cache local aplica primeiro (instantâneo), o servidor corrige depois. Se os
 * dois divergirem, o SERVIDOR vence — ele representa a última escolha
 * deliberada da pessoa, possivelmente feita em outro dispositivo. A exceção é
 * campo vazio no servidor ("nunca escolheu"), que não sobrescreve nada: aí o
 * local é a única informação que existe.
 *
 * Roda uma vez por sessão. Não é uma query que revalida: preferência muda por
 * ação explícita do dono, e ficar reconciliando por foco de aba faria a mesa
 * piscar de visual no meio de uma partida.
 *
 * ─── CAMPO AUSENTE NÃO APAGA O NAVEGADOR — E O NAVEGADOR SOBE ─────────────
 *
 * A aparência do site e as fichas recentes chegaram depois, e por alguns
 * minutos de cada troca de versão a API e o site podem estar em versões
 * diferentes. Um campo que não veio na resposta (API antiga), vazio de
 * fábrica, ou uma chave que a conta ainda não tem são a MESMA coisa: "a conta
 * ainda não tem isto". O local fica, e o que ele tem de escolha própria sobe
 * — ver `aplicarPreferenciasDaMesa` e `aplicarFichasRecentesDaConta`.
 */

import { useEffect, useRef } from 'react';
import { api } from '../lib/fetcher';
import { useAuthStore } from './auth.store';
import { useAtalhos } from './atalhos.store';
import { useCosmeticos } from '../cosmetics/store';
import {
  aplicarPreferenciasDaMesa,
  aplicarPreferenciasDeInterface,
  observarPreferenciasDaMesa,
  observarPreferenciasDeInterface,
} from './preferencias-da-conta';
import { aplicarFichasRecentesDaConta, observarFichasRecentes } from './fichas-recentes';
import { temaDoPrisma, type CosmeticTier } from '@aethertable/shared-types';
import { useTema } from './tema.store';
import { useCatalogoDeCosmeticos } from '../cosmetics/useCatalogo';

interface PreferenciaDaConta {
  /**
   * Direito a cosmético de apoiador.
   *
   * Vem no MESMO `GET /users/me` das preferências, pela mesma razão de os
   * atalhos virem: uma requisição a mais só para saber um enum seria uma
   * requisição a mais no caminho de entrada da Taverna.
   *
   * O cliente usa isto só para DESABILITAR o que a conta não pode equipar e
   * dizer por quê. Quem recusa de verdade é o servidor
   * (`exigirDireitoAosCosmeticos`) — este campo é conveniência de interface,
   * não trava de segurança.
   */
  supporterTier?: CosmeticTier | null;
  preference?: {
    /** Enum do Prisma: DARK | LIGHT | SYSTEM. Traduzido por `temaDoPrisma`. */
    theme?: string | null;
    sleeveId?: string | null;
    playmatId?: string | null;
    borderId?: string | null;
    titleId?: string | null;
    petId?: string | null;
    nameplateId?: string | null;
    cosmeticosDeOponentes?: boolean | null;
    keybindings?: Record<string, string> | null;
    /**
     * As preferências da MESA (tamanho da carta, grade, painel de vida…).
     *
     * Chega como JSON solto de propósito: a coluna é JSONB e uma versão
     * anterior do cliente pode ter gravado um conjunto diferente de chaves.
     * `normalizarPreferenciasDeMesa` é quem dá forma a isso.
     */
    preferenciasDeMesa?: unknown;
    /** A aparência do site (`PreferenciasDeInterface`). JSON solto, pelo mesmo motivo. */
    preferenciasDeInterface?: unknown;
    /** O "Usadas recentemente" do seletor de fichas. */
    fichasRecentes?: unknown;
  } | null;
}

export function useHidratarPreferencias(): void {
  /**
   * O catálogo autoral, antes de tudo.
   *
   * Não é preferência da conta — é o CONJUNTO de itens que existem. Mora aqui
   * porque os dois lugares que hidratam preferências são exatamente os dois
   * que desenham cosméticos (a Taverna e a mesa), e porque a ordem natural é
   * saber o que existe antes de resolver o que está equipado.
   *
   * O valor devolvido é ignorado de propósito: o efeito colateral (registrar no
   * catálogo global) é o ponto, e a chamada ainda assina este componente à
   * versão, que é o que faz a tela redesenhar quando o catálogo muda.
   */
  useCatalogoDeCosmeticos();

  const token = useAuthStore((s) => s.accessToken);
  const aplicarCosmeticos = useCosmeticos((s) => s.aplicarDoServidor);
  const aplicarAtalhos = useAtalhos((s) => s.aplicarDoServidor);
  const definirTier = useCosmeticos((s) => s.definirTier);
  const aplicarTema = useTema((s) => s.aplicarDoServidor);
  /** Cancela as assinaturas (mesa, aparência, fichas). Ver o efeito abaixo. */
  const pararDeObservar = useRef<(() => void) | null>(null);
  /**
   * O pedido em voo e o token dele. O StrictMode monta, limpa e monta de novo:
   * a segunda montagem do MESMO token aproveita o pedido da primeira em vez de
   * abrir outro, e a resposta é aplicada uma vez, pela montagem que ficou.
   */
  const emVoo = useRef<{ token: string; pedido: Promise<PreferenciaDaConta> } | null>(null);

  /**
   * ─── UMA HIDRATAÇÃO POR TOKEN ──────────────────────────────────────────
   *
   * `token` entra nas dependências porque a reidratação do zustand o preenche
   * DEPOIS do primeiro render — sem ele, o efeito rodaria com `null` e
   * desistiria para sempre.
   *
   * Havia também uma guarda `jaBuscou` que só era devolvida quando a resposta
   * ainda não tinha chegado. Trocar a senha troca o token (o servidor corta as
   * outras sessões e devolve um novo): a limpeza desligava o observador das
   * preferências de mesa, e a guarda impedia o token novo de buscar e religá-
   * lo. Dali em diante, nada do que a pessoa mudasse na mesa chegava à conta.
   * Token novo é sessão nova — inclusive no login de outra conta na mesma aba
   * —, e ela hidrata e observa de novo.
   */
  useEffect(() => {
    if (!token) return;

    let ativo = true;
    const pedido =
      emVoo.current?.token === token ? emVoo.current.pedido : api<PreferenciaDaConta>('/users/me');
    emVoo.current = { token, pedido };
    void pedido
      .finally(() => {
        if (emVoo.current?.pedido === pedido) emVoo.current = null;
      })
      .then((eu) => {
        if (!ativo) return;
        // O tier chega mesmo quando `preference` é nula: uma conta que nunca
        // mexeu em cosmético nenhum ainda pode ser apoiadora.
        definirTier(eu?.supporterTier ?? 'FREE');
        /**
         * Conta sem linha de preferências é "nunca configurou nada", e não
         * motivo para desistir.
         *
         * Aqui havia um `return` quando `preference` vinha nula — e com ele
         * o observador nunca ligava: numa conta nova, nada do que a pessoa
         * ajustasse na mesa chegava à conta até ela equipar um cosmético (que
         * cria a linha) e entrar de novo. Nula vale o mesmo que `{}`: nada a
         * aplicar, e o que o navegador tiver de próprio sobe.
         */
        const p = eu?.preference ?? {};
        // O tema da CONTA vence o do `localStorage` — que ja foi aplicado na
        // carga para nao piscar. Quem escolheu claro noutra maquina abre claro
        // aqui tambem.
        if (p.theme) aplicarTema(temaDoPrisma(p.theme));
        aplicarCosmeticos({
          ...(p.sleeveId ? { sleeveId: p.sleeveId } : {}),
          ...(p.playmatId ? { playmatId: p.playmatId } : {}),
          ...(p.borderId ? { borderId: p.borderId } : {}),
          ...(p.titleId ? { titleId: p.titleId } : {}),
          ...(p.petId ? { petId: p.petId } : {}),
          ...(p.nameplateId ? { nameplateId: p.nameplateId } : {}),
          ...(typeof p.cosmeticosDeOponentes === 'boolean'
            ? { cosmeticosDeOponentes: p.cosmeticosDeOponentes }
            : {}),
        });
        aplicarAtalhos(p.keybindings);
        // Cada `aplicar…` diz se o navegador tem algo que a conta não tem; o
        // observador correspondente então sobe logo ao ligar.
        const subirMesa = aplicarPreferenciasDaMesa(p.preferenciasDeMesa);
        const subirAparencia = aplicarPreferenciasDeInterface(p.preferenciasDeInterface);
        const subirFichas = aplicarFichasRecentesDaConta(p.fichasRecentes);
        /**
         * Observar só DEPOIS de aplicar.
         *
         * Ligar a assinatura antes faria o próprio `aplicar` agendar um PATCH
         * de volta — e, se a resposta demorasse, o estado local (ainda o
         * padrão) seria gravado por cima do que a conta guardava.
         */
        const pararMesa = observarPreferenciasDaMesa({ enviarJa: subirMesa });
        const pararAparencia = observarPreferenciasDeInterface({ enviarJa: subirAparencia });
        const pararFichas = observarFichasRecentes({ enviarJa: subirFichas });
        pararDeObservar.current = () => {
          pararMesa();
          pararAparencia();
          pararFichas();
        };
      })
      .catch((erro) => {
        // Requisição já descartada pela limpeza: nada a avisar.
        if (!ativo) return;
        /**
         * Falhar aqui é inofensivo, e por isso não vira toast.
         *
         * O jogador segue com o que o `localStorage` tem — o visual e o teclado
         * que ele já estava usando neste navegador. Um aviso de erro sobre
         * cosmético na entrada da taverna seria ruído sobre algo que não impede
         * nada. A próxima sessão tenta de novo.
         */
        console.warn('[preferencias] não foi possível hidratar da conta:', erro);
        /**
         * Sem resposta do servidor NÃO se observa.
         *
         * O que este navegador tem pode ser o padrão de fábrica só porque a
         * hidratação falhou; começar a enviar daqui apagaria na conta a
         * configuração real da pessoa por causa de uma queda de rede.
         */
      });

    return () => {
      // A resposta desta execução não é mais aplicada por ELA; se o token não
      // mudou, a próxima execução reaproveita o mesmo pedido (ver `emVoo`).
      ativo = false;
      pararDeObservar.current?.();
      pararDeObservar.current = null;
    };
  }, [token, aplicarCosmeticos, aplicarAtalhos, definirTier, aplicarTema]);
}
