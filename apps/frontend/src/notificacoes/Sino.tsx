'use client';

/**
 * Sino.tsx — o sino de notificações da casca autenticada.
 *
 * Abre uma gaveta à direita, e não um balão preso ao botão: o sino mora no
 * menu lateral (que pode estar recolhido em 64 px) e no cabeçalho do celular,
 * e um balão ancorado precisaria de três posições diferentes. A gaveta é a
 * mesma em todos.
 *
 * Abrir marca tudo como lido — mas o que ERA novo continua destacado enquanto
 * a gaveta está aberta, senão a pessoa não saberia o que acabou de chegar.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Heart, Megaphone, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { NOVIDADE_MAIS_RECENTE } from '../novidades/novidades';
import { useNaoLidas, useNotificacoes, type Notificacao } from './useNotificacoes';
import { useT } from '../i18n/i18n';

const RELATIVO = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** "há 5 minutos", "ontem", "há 3 dias". */
export function haQuantoTempo(iso: string, agora = Date.now()): string {
  const segundos = Math.round((new Date(iso).getTime() - agora) / 1000);
  const passos: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unidade, tamanho] of passos) {
    if (Math.abs(segundos) >= tamanho)
      return RELATIVO.format(Math.round(segundos / tamanho), unidade);
  }
  return 'agora';
}

/** `href` ausente: o aviso não leva a lugar nenhum (a denúncia não tem tela para o autor). */
function textoDe(n: Notificacao): { texto: string; href?: string; Icone: typeof Bell } {
  if (n.tipo === 'CURTIDAS') {
    return {
      texto: `"${n.nomeDoDeck}" recebeu ${n.quantas} ${n.quantas === 1 ? 'curtida' : 'curtidas'}.`,
      href: `/dashboard/decks/${n.deckId}`,
      Icone: Heart,
    };
  }
  if (n.tipo === 'COMENTARIOS') {
    return {
      texto: `"${n.nomeDoDeck}" recebeu ${n.quantos} ${n.quantos === 1 ? 'comentário' : 'comentários'}.`,
      href: `/dashboard/decks/${n.deckId}`,
      Icone: MessageSquare,
    };
  }
  return {
    texto:
      n.desfecho === 'RESOLVED'
        ? 'Sua denúncia foi analisada e a moderação tomou uma medida.'
        : 'Sua denúncia foi analisada. Não encontramos violação das regras.',
    Icone: ShieldCheck,
  };
}

export function Sino({ className = '' }: { className?: string }) {
  const { data: notificacoes } = useNotificacoes();
  const { total, novidadeNova, vistoEm, marcarComoLido } = useNaoLidas(notificacoes);
  const [aberto, setAberto] = useState(false);
  const t = useT();
  // O corte do momento em que a gaveta abriu: o que veio depois dele é "novo".
  const [corte, setCorte] = useState<{ vistoEm: string | null; novidade: boolean } | null>(null);

  const abrir = () => {
    setCorte({ vistoEm, novidade: novidadeNova });
    marcarComoLido();
    setAberto(true);
  };

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  return (
    <>
      <button
        onClick={abrir}
        className={`text-text-muted hover:text-text hover:bg-panel-hover relative rounded-md p-2 transition-colors ${className}`}
        aria-label={total ? t('Notificações: {n} novas', { n: total }) : t('Notificações')}
        title={t('Notificações')}
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="bg-danger absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAberto(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-do-sino"
            className="bg-panel border-panel-border absolute right-0 top-0 flex h-full w-full max-w-sm animate-[fadeIn_0.15s_ease-out] flex-col border-l shadow-2xl"
          >
            <header className="border-panel-border flex items-center justify-between border-b p-4">
              <h2 id="titulo-do-sino" className="text-text flex items-center gap-2 font-bold">
                <Bell className="text-primary h-5 w-5" /> {t('Notificações')}
              </h2>
              <button
                onClick={() => setAberto(false)}
                autoFocus
                className="text-text-muted hover:text-text hover:bg-panel-hover rounded-md p-1.5"
                aria-label={t('Fechar')}
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
              <Link
                href="/dashboard/novidades"
                onClick={() => setAberto(false)}
                className={`border-panel-border hover:border-primary block rounded-lg border p-3 transition-colors ${
                  corte?.novidade ? 'bg-primary/10' : ''
                }`}
              >
                <p className="text-primary mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <Megaphone className="h-3.5 w-3.5" /> {t('Novidades da versão')}{' '}
                  {NOVIDADE_MAIS_RECENTE.versao}
                  {corte?.novidade && (
                    <span className="bg-primary rounded-full px-1.5 text-[10px] text-white">
                      nova
                    </span>
                  )}
                </p>
                <p className="text-text text-sm font-semibold">{NOVIDADE_MAIS_RECENTE.titulo}</p>
                <p className="text-text-muted mt-1 text-xs">{t('Ver o que mudou →')}</p>
              </Link>

              {(notificacoes ?? []).length === 0 ? (
                <p className="text-text-muted py-6 text-center text-sm">
                  {t('Nenhum aviso nos últimos 30 dias.')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {notificacoes!.map((n) => {
                    const { texto, href, Icone } = textoDe(n);
                    const nova = !corte?.vistoEm || n.em > corte.vistoEm;
                    const classe = `flex items-start gap-3 rounded-lg p-2 transition-colors ${
                      nova ? 'bg-primary/5' : ''
                    }`;
                    const conteudo = (
                      <>
                        <Icone className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="text-text block text-sm">{texto}</span>
                          <span className="text-text-faint text-xs">{haQuantoTempo(n.em)}</span>
                        </span>
                        {nova && (
                          <span
                            className="bg-primary mt-1.5 h-2 w-2 shrink-0 rounded-full"
                            aria-label="novo"
                          />
                        )}
                      </>
                    );
                    return (
                      <li
                        key={`${n.tipo}-${n.tipo === 'DENUNCIA_ANALISADA' ? n.denunciaId : n.deckId}`}
                      >
                        {href ? (
                          <Link
                            href={href}
                            onClick={() => setAberto(false)}
                            className={`hover:bg-panel-hover ${classe}`}
                          >
                            {conteudo}
                          </Link>
                        ) : (
                          <div className={classe}>{conteudo}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
