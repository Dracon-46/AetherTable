'use client';

/**
 * AtalhosEditor.tsx — a lista de atalhos, agora editável.
 *
 * ─── ERA UMA TABELA DE LEITURA, E ISSO NÃO BASTAVA ─────────────────────────
 *
 * O menu da Mesa mostrava um punhado de teclas fixas e nada mais. Quem joga com teclado
 * ABNT2, quem usa uma mão só, quem tem a mão esquerda no mouse — todos ficavam
 * com o mapa que eu escolhi. E `user_preferences.keybindings` estava no banco
 * desde a primeira migração esperando exatamente isto.
 *
 * ─── AS QUATRO DECISÕES DE INTERAÇÃO ───────────────────────────────────────
 *
 * 1. CAPTURA, NÃO CAMPO DE TEXTO. Clicar na tecla arma "aperte agora" e a
 *    próxima tecla vira o atalho. Digitar o nome da tecla num campo obrigaria
 *    o jogador a saber que a canônica de Esc é `escape` e a de ↑ é `arrowup`.
 *
 * 2. A CAPTURA ROUBA O EVENTO. O listener entra na fase de CAPTURA e chama
 *    `stopPropagation`: sem isso, apertar `d` para remapear compraria uma carta
 *    no meio do remapeamento, porque `useAtalhosDaMesa` escuta a mesma janela.
 *
 * 3. Esc CANCELA, Backspace DESLIGA. São dois pedidos diferentes — "deixa como
 *    estava" e "não quero tecla para isto" — e um só gesto para os dois faria
 *    o jogador não ter como desistir depois de abrir a captura. É por isso que
 *    Esc não pode ser remapeado por aqui: a tecla de fuga precisa ser sempre a
 *    mesma. `LIMPAR_SELECAO` continua editável pelo teclado da mesa e mostra a
 *    tecla atual; só a captura reserva o Esc para si.
 *
 * 4. CONFLITO É RESOLVIDO, NÃO PROIBIDO. Duas ações na mesma tecla produzem um
 *    atalho cuja função depende da ordem de uma constante. O editor avisa quem
 *    vai perder a tecla ANTES, e o store tira a tecla do outro ao gravar.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  ACOES_DE_ATALHO,
  TECLA_NAO_ATRIBUIDA,
  normalizarTecla,
  type AcaoDeAtalho,
  type GrupoDeAtalho,
} from '@aethertable/shared-types';
import { useAtalhos } from '../store/atalhos.store';
import { GESTOS_DE_MOUSE, formatarTecla } from '../net/atalhos';

const NOME_DO_GRUPO: Record<GrupoDeAtalho, string> = {
  MESA: 'Mesa',
  GRIMORIO: 'Grimório',
  SELECAO: 'Carta selecionada',
  EXIBICAO: 'Exibição',
};

export function AtalhosEditor() {
  const atalhos = useAtalhos((s) => s.atalhos);
  const remapear = useAtalhos((s) => s.remapear);
  const restaurarPadrao = useAtalhos((s) => s.restaurarPadrao);

  /** Ação esperando a próxima tecla. `null` = ninguém. */
  const [capturando, setCapturando] = useState<AcaoDeAtalho | null>(null);
  /**
   * Última ação que PERDEU a tecla para outra.
   *
   * O aviso vem depois do gesto, e não antes, porque antes de a tecla ser
   * apertada não há conflito nenhum para anunciar. Sem este aviso o jogador
   * remapeia "virar" para 'g', descobre semanas depois que "para o cemitério"
   * parou de funcionar, e não tem como ligar as duas coisas.
   */
  const [roubada, setRoubada] = useState<{ de: AcaoDeAtalho; tecla: string } | null>(null);

  const donoDaTecla = useCallback(
    (tecla: string, exceto: AcaoDeAtalho): AcaoDeAtalho | null => {
      if (!tecla) return null;
      const achou = ACOES_DE_ATALHO.find((a) => a.id !== exceto && atalhos[a.id] === tecla);
      return achou ? achou.id : null;
    },
    [atalhos],
  );

  useEffect(() => {
    if (!capturando) return;

    const onKey = (e: KeyboardEvent) => {
      // Fase de captura + stopPropagation: o teclado da mesa não pode ver esta
      // tecla, senão remapear "comprar" compra uma carta.
      e.preventDefault();
      e.stopPropagation();

      const nome = e.key.toLowerCase();

      // Modificador apertado sozinho não é atalho: enquanto o jogador segura
      // Ctrl para compor Ctrl+K, o keydown do próprio Ctrl chega primeiro.
      if (nome === 'control' || nome === 'shift' || nome === 'alt' || nome === 'meta') return;

      if (nome === 'escape') {
        setCapturando(null);
        return;
      }
      if (nome === 'backspace' || nome === 'delete') {
        remapear(capturando, TECLA_NAO_ATRIBUIDA);
        setCapturando(null);
        return;
      }

      const nova = normalizarTecla(e);
      // Quem tinha a tecla é lido ANTES da gravação: depois dela o store já
      // zerou a tecla do antigo dono e a informação teria desaparecido.
      const anterior = donoDaTecla(nova, capturando);
      remapear(capturando, nova);
      setRoubada(anterior ? { de: anterior, tecla: nova } : null);
      setCapturando(null);
    };

    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturando, remapear, donoDaTecla]);

  return (
    <div className="mt-2">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-text-faint min-w-0 flex-1 text-[10px] leading-snug">
          Clique numa tecla e aperte a nova.{' '}
          <kbd className="border-panel-border bg-table-deep rounded border px-1 font-mono">Esc</kbd>{' '}
          cancela,{' '}
          <kbd className="border-panel-border bg-table-deep rounded border px-1 font-mono">
            Backspace
          </kbd>{' '}
          deixa sem tecla.
        </p>
        <button
          onClick={() => {
            setCapturando(null);
            setRoubada(null);
            restaurarPadrao();
          }}
          className="text-text-muted hover:text-primary flex shrink-0 items-center gap-1 text-[10px] transition-colors"
          title="Devolve todas as ações às teclas de fábrica"
        >
          <RotateCcw className="h-3 w-3" /> padrão
        </button>
      </div>

      {(['MESA', 'GRIMORIO', 'SELECAO', 'EXIBICAO'] as GrupoDeAtalho[]).map((grupo) => (
        <div key={grupo} className="mb-2">
          <span className="text-text-muted mb-1 block text-[10px] font-bold uppercase tracking-wider">
            {NOME_DO_GRUPO[grupo]}
          </span>
          <dl className="flex flex-col gap-1">
            {ACOES_DE_ATALHO.filter((a) => a.grupo === grupo).map((acao) => {
              const tecla = atalhos[acao.id];
              const emCaptura = capturando === acao.id;
              return (
                <div key={acao.id} className="flex items-center justify-between gap-2">
                  <dd className="text-text-muted order-2 min-w-0 flex-1 text-right text-[10px] leading-snug">
                    {acao.descricao}
                  </dd>
                  <dt className="order-1 shrink-0">
                    <button
                      onClick={() => {
                        setRoubada(null);
                        setCapturando(emCaptura ? null : acao.id);
                      }}
                      aria-label={`Atalho de ${acao.descricao}`}
                      className={`min-w-[4.5rem] rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                        emCaptura
                          ? 'border-warning text-warning animate-pulse'
                          : tecla
                            ? 'border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary'
                            : 'border-panel-border bg-table-deep text-text-faint hover:border-primary'
                      }`}
                    >
                      {emCaptura ? 'aperte…' : formatarTecla(tecla)}
                    </button>
                  </dt>
                </div>
              );
            })}
          </dl>
        </div>
      ))}

      {/* Conflito resolvido, e dito em voz alta: uma tecla é de uma ação só, e
          quem a perdeu fica nomeado na tela em vez de parar de funcionar em
          silêncio. */}
      {roubada && (
        <p className="text-warning mb-2 text-[10px] leading-snug">
          {formatarTecla(roubada.tecla)} era de “
          {ACOES_DE_ATALHO.find((a) => a.id === roubada.de)?.descricao}”, que ficou sem tecla.
        </p>
      )}

      {/* Gestos de mouse: não são remapeáveis (estão presos ao gesto que o
          tabuleiro implementa), mas quem procura "como faço isso rápido"
          procura na mesma lista. */}
      <div>
        <span className="text-text-muted mb-1 block text-[10px] font-bold uppercase tracking-wider">
          Mouse
        </span>
        <dl className="flex flex-col gap-1">
          {GESTOS_DE_MOUSE.map((g) => (
            <div key={g.gesto} className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0">
                <kbd className="border-panel-border bg-table-deep text-text-faint rounded border px-1.5 py-0.5 font-mono text-[10px]">
                  {g.gesto}
                </kbd>
              </dt>
              <dd className="text-text-muted min-w-0 flex-1 text-right text-[10px] leading-snug">
                {g.descricao}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
