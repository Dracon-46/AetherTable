'use client';

/**
 * AcoesDoDeck.tsx — o que se faz COM o deck, e não com uma carta dele.
 *
 * Testar, exportar, publicar e descrever moravam em lugar nenhum: o deck entrava
 * pelo importador e não saía mais (DOC-094 I.7), testar exigia voltar ao painel
 * e montar uma mesa à mão, e `description` e `isPublic` existiam na tabela sem
 * caminho de escrita. Ficam juntos aqui para a página do editor — que já é a
 * maior tela do produto — só os posicionar.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Globe,
  Languages,
  Lock,
  Loader2,
  Play,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IDIOMAS_DE_CARTA, nomeDoIdioma, normalizarConfigDeSala } from '@aethertable/shared-types';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useToast } from '@/components/Toast';
import { lembrarDeckDaSala } from '@/cards/deck-da-sala';
import { exportarLista } from './agrupar';
import { chavesDeDeck, useAtualizarDeck, type DeckCarta, type DeckResumo } from './useDecks';
import { useAparencia } from '../store/aparencia.store';

const botao =
  'border-panel-border bg-panel text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 sm:text-sm';

/**
 * ─── TESTAR = UMA MESA SOLO, PRIVADA, COM ESTE DECK ────────────────────────
 *
 * O mesmo caminho do painel (criar → passe → mesa), sem o formulário: formato
 * "Teste solo" (um assento, zona de comando, sem validação de formato) e o
 * deck já no passe. A navegação é carga completa de página pelo mesmo motivo
 * escrito em `dashboard/page.tsx`: o passe é de uso único, e o `router.push`
 * com o StrictMode o queimaria duas vezes.
 */
export function BotaoTestar({ deck }: { deck: Pick<DeckResumo, 'id' | 'name'> }) {
  const [abrindo, setAbrindo] = useState(false);
  const avisar = useToast((s) => s.mostrar);

  const testar = async () => {
    setAbrindo(true);
    try {
      const config = normalizarConfigDeSala({
        nome: `Teste: ${deck.name}`.slice(0, 40),
        gameType: 'solo',
        visibilidade: 'PRIVADA',
        maxClients: 1,
      });
      const criada = await api<{ roomCode: string; configToken?: string }>('/matches/create', {
        method: 'POST',
        body: config,
      });
      const passe = await api<{ seatToken: string }>(`/matches/${criada.roomCode}/join`, {
        method: 'POST',
        body: {
          deckId: deck.id,
          ...(criada.configToken ? { configToken: criada.configToken } : {}),
        },
      });
      lembrarDeckDaSala(criada.roomCode, deck.id);
      window.location.href = `/play/${criada.roomCode}?token=${passe.seatToken}&maxClients=1&gameType=solo`;
    } catch (erro) {
      avisar(mensagemDaApi(erro), 'erro');
      setAbrindo(false);
    }
  };

  return (
    <button
      onClick={() => void testar()}
      disabled={abrindo}
      className="bg-primary hover:bg-primary-hover flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold text-white transition-colors disabled:opacity-60 sm:text-sm"
      title="Abre uma mesa solo e privada com este deck"
    >
      {abrindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      Testar
    </button>
  );
}

/** Copiar a lista (com ou sem coleção) ou baixá-la como .txt. */
export function MenuExportar({ cartas, nome }: { cartas: readonly DeckCarta[]; nome: string }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const avisar = useToast((s) => s.mostrar);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const copiar = async (rotulo: string, comEdicao: boolean) => {
    try {
      await navigator.clipboard.writeText(exportarLista(cartas, { comEdicao }));
      setCopiado(rotulo);
      setTimeout(() => setCopiado(null), 1600);
    } catch {
      avisar('O navegador não deixou copiar. Use "Baixar .txt".', 'info');
    }
  };

  const baixar = () => {
    const blob = new Blob([exportarLista(cartas, { comEdicao: true })], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Nome de arquivo sem os caracteres que o Windows recusa.
    a.download = `${nome.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setAberto(false);
  };

  const item =
    'text-text hover:bg-panel-hover flex w-full items-center gap-2 px-3 py-2 text-left text-sm';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        disabled={cartas.length === 0}
        aria-expanded={aberto}
        className={botao}
      >
        <Download className="h-4 w-4" />
        Exportar
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <div
          role="menu"
          className="border-panel-border bg-panel absolute right-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-lg border py-1 shadow-xl"
        >
          <button role="menuitem" className={item} onClick={() => void copiar('lista', false)}>
            {copiado === 'lista' ? (
              <Check className="text-success h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copiar lista (nome e quantidade)
          </button>
          <button role="menuitem" className={item} onClick={() => void copiar('edicao', true)}>
            {copiado === 'edicao' ? (
              <Check className="text-success h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            Copiar com a coleção (Moxfield, Archidekt)
          </button>
          <button role="menuitem" className={item} onClick={baixar}>
            <Download className="h-4 w-4" />
            Baixar .txt
          </button>
        </div>
      )}
    </div>
  );
}

/** Público aparece no Explorar; privado só para o dono. */
export function InterruptorPublico({ deck }: { deck: Pick<DeckResumo, 'id' | 'isPublic'> }) {
  const atualizar = useAtualizarDeck();
  const publico = Boolean(deck.isPublic);
  return (
    <button
      onClick={() => atualizar.mutate({ deckId: deck.id, dados: { isPublic: !publico } })}
      aria-pressed={publico}
      className={`${botao} ${publico ? 'border-primary/60 text-primary' : ''}`}
      title={
        publico
          ? 'Público: aparece no Explorar e qualquer pessoa pode ver a lista'
          : 'Privado: só você vê este deck'
      }
    >
      {publico ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      {publico ? 'Público' : 'Privado'}
    </button>
  );
}

/**
 * A descrição do deck: estratégia, combos, trocas planejadas.
 *
 * Salva ao sair do campo, e não a cada tecla — uma requisição por letra
 * esbarraria no throttler das rotas de deck.
 */
export function DescricaoDoDeck({
  deck,
  somenteLeitura,
}: {
  deck: Pick<DeckResumo, 'id' | 'description'>;
  somenteLeitura: boolean;
}) {
  const atualizar = useAtualizarDeck();
  const [texto, setTexto] = useState(deck.description ?? '');

  // Trocar de deck (ou o servidor responder) recarrega o texto do campo.
  useEffect(() => {
    setTexto(deck.description ?? '');
  }, [deck.id, deck.description]);

  if (somenteLeitura) {
    if (!deck.description) return null;
    return (
      <p className="text-text-muted mb-5 whitespace-pre-line text-sm leading-relaxed">
        {deck.description}
      </p>
    );
  }

  return (
    <textarea
      value={texto}
      onChange={(e) => setTexto(e.target.value.slice(0, 2000))}
      onBlur={() => {
        if (texto.trim() !== (deck.description ?? '').trim()) {
          atualizar.mutate({ deckId: deck.id, dados: { description: texto.trim() } });
        }
      }}
      rows={2}
      placeholder="Descrição: a estratégia do deck, os combos, o que você quer trocar…"
      aria-label="Descrição do deck"
      className="border-panel-border bg-panel text-text placeholder:text-text-faint focus:border-primary mb-5 w-full resize-y rounded-md border px-3 py-2 text-sm focus:outline-none"
    />
  );
}

/**
 * ─── O DECK INTEIRO NUM IDIOMA ─────────────────────────────────────────────
 *
 * Um clique troca cada carta pela impressão mais recente no idioma escolhido
 * (ver `trocarIdioma` no backend). O idioma preferido, dos Ajustes, vem
 * primeiro na lista. A resposta diz quantas mudaram e quais ficaram como
 * estavam por não terem saído naquele idioma.
 */
export function MenuIdioma({ deckId, vazio }: { deckId: string; vazio: boolean }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const preferido = useAparencia((s) => s.idiomaDasCartas);
  const avisar = useToast((s) => s.mostrar);
  const qc = useQueryClient();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const trocar = useMutation({
    mutationFn: (idioma: string) =>
      api<{ trocadas: number; semImpressao: string[] }>(`/decks/${deckId}/idioma`, {
        method: 'POST',
        body: { idioma },
      }),
    onSuccess: (r, idioma) => {
      void qc.invalidateQueries({ queryKey: chavesDeDeck.um(deckId) });
      void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
      const em = nomeDoIdioma(idioma).toLowerCase();
      const faltaram = r.semImpressao.length;
      avisar(
        faltaram
          ? `${r.trocadas} carta(s) em ${em}. ${faltaram} nunca saíram nesse idioma e ficaram como estavam.`
          : `${r.trocadas} carta(s) em ${em}.`,
        faltaram ? 'info' : 'sucesso',
      );
    },
    onError: (e) => avisar(mensagemDaApi(e), 'erro'),
  });

  const ordem = [
    ...IDIOMAS_DE_CARTA.filter((i) => i.codigo === preferido),
    ...IDIOMAS_DE_CARTA.filter((i) => i.codigo !== preferido),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        disabled={vazio || trocar.isPending}
        aria-expanded={aberto}
        className={botao}
      >
        {trocar.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Languages className="h-4 w-4" />
        )}
        Idioma
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {aberto && (
        <div
          role="menu"
          className="border-panel-border bg-panel absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border py-1 shadow-xl"
        >
          <p className="text-text-faint px-3 py-1.5 text-[11px]">Pôr o deck em…</p>
          {ordem.map((i) => (
            <button
              key={i.codigo}
              role="menuitem"
              onClick={() => {
                setAberto(false);
                trocar.mutate(i.codigo);
              }}
              className="text-text hover:bg-panel-hover flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
            >
              {i.nome}
              {i.codigo === preferido && (
                <span className="text-text-faint text-[10px]">preferido</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
