'use client';

/**
 * ExibicaoControls.tsx — o que o jogador escolhe sobre o HUD da mesa.
 *
 * ─── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * O painel de vida (`vidaModo`), a barra de ações (`barraAberta`) e o log já
 * eram preferências PERSISTIDAS, e o único jeito de mexer nelas era achar o
 * botãozinho dentro de cada painel. Não havia um lugar onde "como eu quero a
 * tela" fosse uma pergunta única.
 *
 * ─── NÃO HÁ CONTROLE DE ZOOM, E ISSO É O PEDIDO ────────────────────────────
 *
 * Havia presets de zoom e um "recentrar" aqui. A mesa passou a ser montada em
 * pixels reais e ocupa a tela inteira (`montarMesaFocada`), então zoom serviria
 * para uma coisa só: afastar a câmera e voltar a ter carta ilegível — que é
 * exatamente o que o jogador pediu para não existir.
 *
 * ─── E POR QUE ELE NÃO TEM MAIS ARRANJO NEM QUALIDADE ──────────────────────
 *
 * Uma versão anterior deste painel oferecia três coisas a mais: arranjo das
 * mesas (grade/faixas), qualidade de desenho (sombras e interpolação) e
 * contornos de zona. As três dependiam de mudanças no `GameBoard` que eu
 * escrevi sem nunca abrir a mesa, e que quebraram o tabuleiro: cartas
 * minúsculas, travamento e arraste/compra sem funcionar. O `GameBoard` foi
 * revertido para a versão que funcionava, e estes controles saíram junto.
 *
 * Deixá-los aqui apontando para um estado que ninguém mais lê seria pior do
 * que não tê-los: o jogador desligaria a sombra, veria o mesmo quadro travado
 * e concluiria que o problema é outro. Um interruptor que não liga nada mente.
 *
 * Eles voltam quando o ganho de render estiver medido na mesa de verdade, não
 * deduzido do código.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Grid2x2 } from 'lucide-react';
import {
  ChevronDown,
  Footprints,
  Heart,
  MessageSquare,
  PanelBottom,
  PanelRight,
  SlidersHorizontal,
} from 'lucide-react';
import { useUIStore } from '../store/game.store';

/** Um grupo de botões mutuamente exclusivos. */
function Segmentado<T extends string>({
  rotulo,
  valor,
  opcoes,
  onEscolher,
}: {
  rotulo: string;
  valor: T;
  opcoes: Array<{ valor: T; texto: string; Icone?: typeof Grid2x2; dica?: string }>;
  onEscolher: (v: T) => void;
}) {
  return (
    <div className="border-panel-border border-t px-3 py-2.5 first:border-t-0">
      <span className="text-text-muted mb-1.5 block text-[10px] font-bold uppercase tracking-wider">
        {rotulo}
      </span>
      <div className="flex gap-1" role="group" aria-label={rotulo}>
        {opcoes.map((o) => (
          <button
            key={o.valor}
            onClick={() => onEscolher(o.valor)}
            aria-pressed={valor === o.valor}
            title={o.dica}
            className={`border-panel-border bg-table-deep flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
              valor === o.valor
                ? 'border-primary text-primary font-bold'
                : 'text-text hover:border-primary hover:text-primary'
            }`}
          >
            {o.Icone && <o.Icone className="h-3.5 w-3.5 shrink-0" />}
            {o.texto}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Um interruptor de duas posições, com o estado dito por escrito. */
function Interruptor({
  rotulo,
  Icone,
  ligado,
  onAlternar,
  dica,
}: {
  rotulo: string;
  Icone: typeof Grid2x2;
  ligado: boolean;
  onAlternar: () => void;
  dica?: string;
}) {
  return (
    <button
      onClick={onAlternar}
      role="switch"
      aria-checked={ligado}
      title={dica}
      className="border-panel-border hover:bg-panel-hover flex w-full items-center justify-between gap-2 border-t px-3 py-2.5 text-left text-xs transition-colors"
    >
      <span className="text-text flex items-center gap-2">
        <Icone className="text-text-muted h-3.5 w-3.5 shrink-0" />
        {rotulo}
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
          ligado ? 'bg-primary/20 text-primary' : 'bg-table-deep text-text-faint'
        }`}
      >
        {ligado ? 'ligado' : 'desligado'}
      </span>
    </button>
  );
}

export function ExibicaoControls() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const vidaModo = useUIStore((s) => s.vidaModo);
  const setVidaModo = useUIStore((s) => s.setVidaModo);
  const barraAberta = useUIStore((s) => s.barraAberta);
  const setBarraAberta = useUIStore((s) => s.setBarraAberta);
  const logAberto = useUIStore((s) => s.logAberto);
  const setLogAberto = useUIStore((s) => s.setLogAberto);
  const trilhoAberto = useUIStore((s) => s.trilhoAberto);
  const setTrilhoAberto = useUIStore((s) => s.setTrilhoAberto);
  const seguirTurno = useUIStore((s) => s.seguirTurno);
  const setSeguirTurno = useUIStore((s) => s.setSeguirTurno);

  useEffect(() => {
    if (!aberto) return;
    const aoApontar = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', aoApontar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoApontar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    // Sem `absolute`: quem posiciona é a fileira do topo direito, em
    // `play/[roomId]/page.tsx` — ver o mesmo comentário em `CameraControls`.
    <div ref={ref} className="pointer-events-auto relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="border-panel-border bg-panel/90 text-text hover:border-primary hover:text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors"
        title="Como você vê a mesa"
        aria-expanded={aberto}
      >
        <SlidersHorizontal className="text-primary h-4 w-4 shrink-0" />
        <span className="hidden sm:inline">Exibição</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        // O teto de altura não é decoração: sem ele o painel passa do rodapé
        // em qualquer tela de 720p e as últimas seções ficam inalcançáveis —
        // o mesmo problema que o menu da Mesa já tinha tido.
        <div className="painel-entra custom-scrollbar border-panel-border bg-panel absolute right-0 top-full mt-1 max-h-[calc(100dvh-5rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border shadow-2xl">
          <Segmentado
            rotulo="Painel de vida"
            valor={vidaModo}
            onEscolher={setVidaModo}
            opcoes={[
              { valor: 'minima', texto: 'Selo', Icone: Heart, dica: 'Só o seu total, num selo' },
              { valor: 'minha', texto: 'Meu', dica: 'Só o seu cartão de vida' },
              {
                valor: 'mesa',
                texto: 'Mesa',
                dica: 'Todos os jogadores, com dano de comandante e contadores',
              },
            ]}
          />

          <Interruptor
            rotulo="Mesa dos oponentes"
            Icone={PanelRight}
            ligado={trilhoAberto}
            onAlternar={() => setTrilhoAberto(!trilhoAberto)}
            dica="O trilho da direita mostra a mesa de cada oponente em miniatura. Ele flutua sobre o campo, então abrir e fechar NÃO muda o tamanho das suas cartas."
          />
          <Interruptor
            rotulo="Câmera segue o turno"
            Icone={Footprints}
            ligado={seguirTurno}
            onAlternar={() => setSeguirTurno(!seguirTurno)}
            dica="Ao passar o turno, a tela vai sozinha para a mesa de quem entrou na vez. É preferência sua: ninguém move a câmera de ninguém."
          />
          <Interruptor
            rotulo="Barra de ações fixa"
            Icone={PanelBottom}
            ligado={barraAberta}
            onAlternar={() => setBarraAberta(!barraAberta)}
            dica="Recolhida, ela vira uma aba e devolve a borda inferior ao tabuleiro"
          />
          <Interruptor
            rotulo="Log da partida"
            Icone={MessageSquare}
            ligado={logAberto}
            onAlternar={() => setLogAberto(!logAberto)}
            dica="Recolhido, sobra só o cabeçalho com a última linha"
          />
        </div>
      )}
    </div>
  );
}
