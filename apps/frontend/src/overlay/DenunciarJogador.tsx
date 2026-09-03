'use client';

/**
 * DenunciarJogador.tsx — a denúncia feita de dentro da mesa (DOC-061 §4).
 *
 * ─── DENUNCIAR ERA IMPOSSÍVEL ──────────────────────────────────────────────
 *
 * A tabela `reports` existia no schema desde o começo, com `status`,
 * `ReportReason` e as relações certas. E não havia UMA superfície que
 * escrevesse nela: nem no jogo, nem num painel (que não existia). O modelo de
 * dados previa moderação e a plataforma não tinha como receber uma denúncia.
 *
 * Uma fila de moderação sem porta de entrada é meio sistema — ela nunca enche,
 * e a conclusão de quem olha é que ninguém se comporta mal.
 *
 * ─── O SNAPSHOT É O QUE FAZ A DENÚNCIA VALER ALGO ──────────────────────────
 *
 * O estado da sala vive na RAM do game node (ADR-006, RN12) e desaparece
 * quando a partida acaba. Sem copiar as últimas linhas do log e do chat no
 * momento do clique, toda denúncia chegaria ao moderador sem nada para
 * analisar — e áudio não é gravado, por decisão de privacidade.
 *
 * O que vai é o log que o CLIENTE tem, então é dado do denunciante e o painel
 * o apresenta como citação, nunca como registro do sistema.
 */

import React, { useMemo, useState } from 'react';
import { AlertCircle, Flag, Loader2, ShieldAlert, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useGameStore } from '../store/game.store';
import { useCardCatalog } from '../cards/catalog';
import { useToast } from '../components/Toast';

const MOTIVOS = [
  { valor: 'HARASSMENT', rotulo: 'Assédio ou ofensa pessoal' },
  { valor: 'CHEATING', rotulo: 'Trapaça / conduta anti-jogo' },
  { valor: 'HATE_SPEECH', rotulo: 'Discurso de ódio' },
  { valor: 'SPAM', rotulo: 'Spam ou flood no chat' },
  { valor: 'OTHER', rotulo: 'Outro' },
] as const;

/** Quantas linhas do log viajam como evidência. Teto do DTO: 60. */
const LINHAS_DE_EVIDENCIA = 40;

export function DenunciarJogador({
  jogador,
  onFechar,
}: {
  jogador: { id: string; userId: string; name: string };
  onFechar: () => void;
}) {
  const log = useGameStore((s) => s.log);
  const players = useGameStore((s) => s.players);
  const roomCode = useGameStore((s) => s.roomId);
  const catalogo = useCardCatalog((s) => s.cartas);
  const avisar = useToast((s) => s.mostrar);

  const [motivo, setMotivo] = useState<string>('HARASSMENT');
  const [detalhes, setDetalhes] = useState('');

  /**
   * As últimas linhas do log, com os nomes resolvidos.
   *
   * O log guarda `actorId` (sessionId) e `{Carta}` com um `scryfallId`: quem
   * conhece nomes é o cliente. Mandar o texto cru faria o moderador ler
   * "aBc123 moveu {Carta}", que não é evidência de nada.
   */
  const snapshot = useMemo(
    () =>
      log.slice(-LINHAS_DE_EVIDENCIA).map((entrada) => ({
        em: entrada.timestamp,
        autor: entrada.actorId ? (players[entrada.actorId]?.name ?? entrada.actorId) : undefined,
        tipo: entrada.type,
        texto: (entrada.scryfallId
          ? entrada.text.replace('{Carta}', catalogo[entrada.scryfallId]?.name ?? 'uma carta')
          : entrada.text
        ).slice(0, 400),
      })),
    [log, players, catalogo],
  );

  const enviar = useMutation({
    mutationFn: () =>
      api<{ id: string; recebida: boolean }>('/reports', {
        method: 'POST',
        body: {
          denunciadoId: jogador.userId,
          motivo,
          detalhes: detalhes.trim() || undefined,
          // `roomCode` agrupa a denúncia por partida — é o que permite ao
          // moderador ver "três pessoas denunciaram a mesma conduta na mesma
          // mesa", que é o padrão que substitui a gravação.
          roomCode: roomCode || undefined,
          snapshot,
        },
      }),
    onSuccess: () => {
      avisar('Denúncia enviada. A moderação vai analisar.', 'sucesso');
      onFechar();
    },
  });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviar.isPending) onFechar();
      }}
    >
      <div className="border-panel-border bg-panel custom-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border p-5 shadow-2xl">
        <div className="mb-1 flex items-start gap-2">
          <Flag className="text-warning mt-0.5 h-5 w-5 shrink-0" />
          <h2 className="text-text min-w-0 flex-1 text-base font-bold">Denunciar {jogador.name}</h2>
          <button
            onClick={onFechar}
            disabled={enviar.isPending}
            className="text-text-muted hover:text-text shrink-0 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-text-muted mb-4 text-sm">
          A denúncia vai para a moderação com as últimas {snapshot.length} linhas do log desta
          partida como evidência.
        </p>

        <div className="mb-4">
          <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
            Motivo
          </label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            {MOTIVOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
            O que aconteceu <span className="text-text-faint normal-case">(opcional)</span>
          </label>
          <textarea
            value={detalhes}
            onChange={(e) => setDetalhes(e.target.value.slice(0, 1000))}
            rows={4}
            placeholder="Descreva a conduta. Quanto mais específico, mais rápido a moderação decide."
            className="bg-table-deep border-panel-border text-text focus:border-primary w-full resize-y rounded-md border px-3 py-2 text-sm focus:outline-none"
          />
        </div>

        {/* Dizer que o áudio NÃO é gravado é honestidade necessária: sem isso,
            quem denuncia ofensa verbal supõe que existe uma gravação e não
            escreve o que ouviu — e a denúncia chega vazia. */}
        <p className="border-panel-border bg-table-deep text-text-faint mb-4 flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            O áudio da mesa <strong>não é gravado</strong>. Se a conduta foi por voz, descreva-a
            acima — ofensa verbal depende do relato e de denúncias de mais pessoas para gerar
            bloqueio.
          </span>
        </p>

        {enviar.isError && (
          <p className="border-danger/30 bg-danger/10 text-danger mb-4 flex items-start gap-2 rounded-md border p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {mensagemDaApi(enviar.error)}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onFechar}
            disabled={enviar.isPending}
            className="text-text-muted hover:text-text rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => enviar.mutate()}
            disabled={enviar.isPending}
            className="bg-warning flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {enviar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar denúncia
          </button>
        </div>
      </div>
    </div>
  );
}
