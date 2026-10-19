'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Plus, Loader2, X, Ghost, Minus, History, Layers, PenLine } from 'lucide-react';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { Room } from 'colyseus.js';
import type { RoomState } from '../net/schema/RoomState';
import { API_URL } from '@/lib/api';
import { cardImageUrl } from '../canvas/textureCache';
import { useFecharComEsc } from './useFecharComEsc';
import { useCardCatalog, useHidratarCartas } from '../cards/catalog';
import { deckDaSala } from '../cards/deck-da-sala';
import { useAuthStore } from '@/store/auth.store';
import {
  lembrarFichaRecente,
  lerFichasRecentes,
  type FichaRecente,
} from '../store/fichas-recentes';

interface TokenPickerProps {
  room: Room<RoomState>;
}

/**
 * Fichas predefinidas (DOC-036 item 79).
 *
 * Tesouro, Pista, Comida, Sangue e Mapa aparecem em praticamente toda partida
 * de Commander moderna. Obrigar o jogador a digitar "treasure" e esperar a
 * busca da Scryfall a cada tesouro gerado é atrito puro: são as fichas mais
 * criadas do formato.
 *
 * A busca usa a sintaxe da Scryfall e devolve a impressão mais recente.
 */
const PRESETS: { rotulo: string; query: string; emoji: string }[] = [
  { rotulo: 'Tesouro', query: 't:token t:treasure', emoji: '💰' },
  { rotulo: 'Pista', query: 't:token t:clue', emoji: '🔍' },
  { rotulo: 'Comida', query: 't:token t:food', emoji: '🍗' },
  { rotulo: 'Sangue', query: 't:token t:blood', emoji: '🩸' },
  { rotulo: 'Mapa', query: 't:token t:map', emoji: '🗺️' },
  { rotulo: 'Pedra de Poder', query: 't:token t:powerstone', emoji: '💎' },
  { rotulo: 'Soldado 1/1', query: 't:token t:soldier pow=1 tou=1', emoji: '🗡️' },
  { rotulo: 'Zumbi 2/2', query: 't:token t:zombie pow=2 tou=2', emoji: '🧟' },
  { rotulo: 'Saproling 1/1', query: 't:token t:saproling', emoji: '🌱' },
  { rotulo: 'Dragão 5/5', query: 't:token t:dragon pow=5 tou=5', emoji: '🐉' },
];

/** O que basta para recriar uma ficha: impressão (se houver), nome e P/R. */
type FichaSalva = FichaRecente;

/** O que a busca de cartas da API devolve e esta tela usa (formato da Scryfall). */
interface FichaDaBusca {
  id: string;
  name: string;
  type_line?: string;
  power?: string;
  toughness?: string;
}

/**
 * ─── "USADAS RECENTEMENTE" ─────────────────────────────────────────────────
 *
 * Quem joga com fichas cria as MESMAS a partida inteira — os Soldados do
 * próprio deck, a Planta do Avenger. Cada criação passava pela busca ou pelo
 * menu da carta de origem. As últimas oito ficam lembradas — na CONTA, com o
 * navegador como cache: é conveniência de quem joga, não estado da mesa, mas
 * trocar de máquina não pode esvaziar a fileira. Ver `store/fichas-recentes.ts`.
 */

/** O termo que o campo pede; `null` com uma letra só (espera a segunda). */
function termoDaBusca(query: string): string | null {
  const texto = query.trim();
  if (texto === '') return 't:token';
  return texto.length >= 2 ? `t:token ${query}` : null;
}

export function TokenPicker({ room }: TokenPickerProps) {
  const isActive = useUIStore((s) => s.activeModals.tokens);
  const toggleModal = useUIStore((s) => s.toggleModal);
  const cards = useGameStore((s) => s.cards);
  const myId = useGameStore((s) => s.mySessionId);
  const catalogo = useCardCatalog((s) => s.cartas);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FichaDaBusca[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [presetEmCurso, setPresetEmCurso] = useState<string | null>(null);
  /**
   * Quantas fichas por clique. O servidor sempre aceitou até 20 de uma vez
   * (`CreateTokenIntent.amount`), e a tela mandava 1: cinco Soldados de um
   * Secure the Wastes eram cinco viagens a este painel.
   */
  const [quantidade, setQuantidade] = useState(1);
  const [recentes, setRecentes] = useState<FichaSalva[]>([]);
  const [idsDoDeck, setIdsDoDeck] = useState<string[]>([]);
  const [personalizada, setPersonalizada] = useState({ nome: '', poder: '', resistencia: '' });

  useFecharComEsc(isActive, () => toggleModal('tokens'));

  useEffect(() => {
    if (!isActive) return;
    setRecentes(lerFichasRecentes());
    setQuantidade(1);
  }, [isActive]);

  /**
   * As cartas do DECK INTEIRO, e não só as visíveis.
   *
   * O grimório é oculto até para o dono, então olhar o mapa de cartas da mesa
   * mostraria as fichas da mão e do campo e esconderia as de tudo o que ainda
   * não foi comprado. A lista vem da API, como no deckbuilder: é o deck do
   * próprio jogador, que ele já pode abrir quando quiser.
   */
  useEffect(() => {
    if (!isActive || !accessToken) return;
    const deckId = deckDaSala(room.state?.roomCode ?? '');
    if (!deckId) return;
    let ativo = true;
    fetch(`${API_URL}/decks/${encodeURIComponent(deckId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((deck: { cards?: { scryfallId: string }[] } | null) => {
        if (!ativo || !deck?.cards) return;
        setIdsDoDeck([...new Set(deck.cards.map((c) => c.scryfallId.toLowerCase()))]);
      })
      .catch(() => {
        /* sem a lista, ainda sobram as fichas das cartas visíveis */
      });
    return () => {
      ativo = false;
    };
  }, [isActive, accessToken, room]);

  /** As minhas cartas que eu enxergo agora — cobre o caso sem deck lembrado. */
  const idsVisiveis = useMemo(
    () =>
      Object.values(cards)
        .filter((c) => c.ownerId === myId && c.scryfallId && !c.isToken)
        .map((c) => c.scryfallId.toLowerCase()),
    [cards, myId],
  );

  useHidratarCartas(isActive ? [...idsDoDeck, ...idsVisiveis] : []);

  const fichasDoDeck = useMemo(() => {
    const vistas = new Map<string, { scryfallId: string; name: string }>();
    for (const id of new Set([...idsDoDeck, ...idsVisiveis])) {
      for (const f of catalogo[id]?.fichas ?? []) {
        if (!vistas.has(f.scryfallId)) vistas.set(f.scryfallId, f);
      }
    }
    return [...vistas.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [idsDoDeck, idsVisiveis, catalogo]);

  /**
   * ─── SÓ A ÚLTIMA BUSCA ESCREVE NA TELA ──────────────────────────────────
   *
   * Digitar "zo", parar, digitar "zombie": as duas buscas saem, e a resposta
   * da primeira podia chegar DEPOIS da segunda. A lista mostrava as fichas de
   * "zo" com "zombie" no campo, e o indicador de busca apagava enquanto a
   * busca que valia ainda estava no ar.
   */
  const ultimaBusca = useRef(0);
  /** O termo cuja resposta está na tela; `null` = nenhuma, ou a última falhou. */
  const termoNaTela = useRef<string | null>(null);

  // A falha já vira lista vazia aqui dentro: quem chama pode disparar e esquecer.
  const performSearch = useCallback(async (termo: string) => {
    ultimaBusca.current += 1;
    const minha = ultimaBusca.current;
    setIsSearching(true);
    try {
      // Espelho do backend: `api.scryfall.com` pode estar bloqueado na rede.
      const res = await fetch(
        `${API_URL}/cards/search?q=${encodeURIComponent(termo)}&order=cmc&dir=asc`,
      );
      const data = res.ok ? ((await res.json()) as { data?: FichaDaBusca[] }) : null;
      if (minha !== ultimaBusca.current) return;
      setResults(data?.data?.slice(0, 30) ?? []);
      termoNaTela.current = data ? termo : null;
    } catch (e) {
      console.error(e);
      if (minha !== ultimaBusca.current) return;
      setResults([]);
      termoNaTela.current = null;
    } finally {
      if (minha === ultimaBusca.current) setIsSearching(false);
    }
  }, []);

  /**
   * ─── PAINEL FECHADO NÃO BUSCA ───────────────────────────────────────────
   *
   * O painel fica montado a partida inteira. O debounce disparava a busca
   * genérica meio segundo depois de cada jogador entrar na mesa, mesmo para
   * quem nunca abriu o painel.
   *
   * Ao ABRIR, busca na hora — a não ser que a lista na tela já seja a resposta
   * do texto do campo. Digitando, espera o debounce.
   */
  const estavaAberto = useRef(false);
  useEffect(() => {
    const acabouDeAbrir = isActive && !estavaAberto.current;
    estavaAberto.current = isActive;
    if (!isActive) return;

    const termo = termoDaBusca(query);
    if (termo === null) return;
    if (acabouDeAbrir) {
      if (termo !== termoNaTela.current) void performSearch(termo);
      return;
    }
    const handler = setTimeout(() => void performSearch(termo), 500);
    return () => clearTimeout(handler);
  }, [isActive, query, performSearch]);

  /** Busca a impressão mais recente do preset e cria a ficha direto. */
  const criarPreset = async (query: string) => {
    setPresetEmCurso(query);
    try {
      const res = await fetch(
        `${API_URL}/cards/search?q=${encodeURIComponent(query)}&order=released&dir=desc`,
      );
      if (!res.ok) throw new Error(`API de cartas respondeu ${res.status}`);
      const data = (await res.json()) as { data?: FichaDaBusca[] };
      const carta = data.data?.[0];
      if (carta) handleCreate(carta);
    } catch (e) {
      // Falha de rede não pode travar o painel: o jogador ainda pode buscar
      // manualmente, e o log do console diz o que aconteceu.
      console.error('[tokens] Falha ao buscar ficha predefinida:', e);
    } finally {
      setPresetEmCurso(null);
    }
  };

  /**
   * Cria `quantidade` fichas e fecha.
   *
   * ─── (0, 0) SIGNIFICA "CENTRO DO MEU CAMPO" ──────────────────────────────
   *
   * `Card.x/y` de uma permanente é FRAÇÃO do campo de quem a controla, e
   * `posicaoNoCampo` trata (0, 0) como "centraliza". É exatamente o que se quer
   * de uma ficha criada por menu, em qualquer resolução. Com várias, o servidor
   * escadeia a partir do centro.
   */
  const criar = (f: FichaSalva, chave: string) => {
    setCreatingId(chave);
    intents.createToken(room, { ...f, amount: quantidade, x: 0, y: 0 });
    setRecentes(lembrarFichaRecente(f));
    setTimeout(() => {
      setCreatingId(null);
      toggleModal('tokens');
    }, 300);
  };

  const handleCreate = (card: FichaDaBusca) =>
    criar(
      { scryfallId: card.id, name: card.name, power: card.power, toughness: card.toughness },
      card.id,
    );

  /**
   * Ficha sem impressão: só nome e P/R. É o caminho para fichas que a
   * Scryfall não tem (as de cartas caseiras, as de "crie uma cópia que é um
   * 4/4 Elemental") — o servidor sempre aceitou `name` sem `scryfallId`.
   */
  const criarPersonalizada = (e: React.FormEvent) => {
    e.preventDefault();
    const nome = personalizada.nome.trim();
    if (!nome) return;
    const temPr = personalizada.poder.trim() !== '' && personalizada.resistencia.trim() !== '';
    criar(
      {
        name: nome.slice(0, 60),
        ...(temPr
          ? { power: personalizada.poder.trim(), toughness: personalizada.resistencia.trim() }
          : {}),
      },
      `personalizada:${nome}`,
    );
    setPersonalizada({ nome: '', poder: '', resistencia: '' });
  };

  if (!isActive) return null;

  const miniatura = (f: FichaSalva, chave: string) => (
    <button
      key={chave}
      onClick={() => criar(f, chave)}
      title={`${f.name}${f.power ? ` ${f.power}/${f.toughness}` : ''}`}
      className="group relative w-20 shrink-0"
    >
      <div className="group-hover:border-primary bg-table-deep flex aspect-[63/88] items-center justify-center overflow-hidden rounded-md border-2 border-transparent transition-colors">
        {f.scryfallId ? (
          <img
            src={cardImageUrl(f.scryfallId, 'small')}
            alt={f.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-text p-1 text-center text-[10px] font-bold leading-tight">
            {f.name}
            {f.power && (
              <span className="text-text-muted block">
                {f.power}/{f.toughness}
              </span>
            )}
          </span>
        )}
        {creatingId === chave && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        )}
      </div>
      <span className="text-text-muted mt-0.5 block truncate text-[10px]">{f.name}</span>
    </button>
  );

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleModal('tokens');
      }}
    >
      <div className="border-panel-border bg-panel/95 flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur">
        <div className="border-panel-border bg-table-deep/50 flex items-center justify-between gap-3 border-b p-4">
          <h3 className="text-text flex items-center gap-2 font-bold">
            <Ghost className="text-primary h-5 w-5" />
            Criar ficha
          </h3>
          <div className="ml-auto flex items-center gap-1.5" aria-label="Quantas fichas">
            <span className="text-text-muted text-[10px] font-bold uppercase">Quantas</span>
            <button
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              className="bg-panel-hover text-text hover:text-primary rounded p-1"
              aria-label="Uma ficha a menos"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="text-text w-6 text-center font-mono text-sm font-bold">
              {quantidade}
            </span>
            <button
              onClick={() => setQuantidade((q) => Math.min(20, q + 1))}
              className="bg-panel-hover text-text hover:text-primary rounded p-1"
              aria-label="Uma ficha a mais"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={() => toggleModal('tokens')}
            className="hover:bg-danger/20 hover:text-danger text-text-muted rounded p-1 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {recentes.length > 0 && (
            <section className="border-panel-border border-b px-4 pt-3">
              <span className="text-text-muted mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <History className="h-3 w-3" /> Usadas recentemente
              </span>
              <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-3">
                {recentes.map((f) => miniatura(f, `recente:${f.scryfallId ?? f.name}`))}
              </div>
            </section>
          )}

          {fichasDoDeck.length > 0 && (
            <section className="border-panel-border border-b px-4 pt-3">
              <span className="text-text-muted mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <Layers className="h-3 w-3" /> Fichas do seu deck
              </span>
              <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-3">
                {fichasDoDeck.map((f) => miniatura(f, `deck:${f.scryfallId}`))}
              </div>
            </section>
          )}

          {/* Atalhos: um clique cria a ficha, sem passar pela busca. */}
          <section className="border-panel-border border-b px-4 pt-3">
            <span className="text-text-muted mb-2 block text-[10px] font-bold uppercase tracking-wider">
              Fichas frequentes
            </span>
            <div className="flex flex-wrap gap-1.5 pb-3">
              {PRESETS.map((p) => (
                <button
                  key={p.rotulo}
                  onClick={() => criarPreset(p.query)}
                  disabled={presetEmCurso === p.query}
                  className="border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors disabled:opacity-50"
                >
                  <span aria-hidden="true">{p.emoji}</span>
                  {p.rotulo}
                  {presetEmCurso === p.query && <Loader2 className="h-3 w-3 animate-spin" />}
                </button>
              ))}
            </div>
          </section>

          <section className="border-panel-border border-b px-4 py-3">
            <span className="text-text-muted mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
              <PenLine className="h-3 w-3" /> Ficha personalizada
            </span>
            <form onSubmit={criarPersonalizada} className="flex flex-wrap items-center gap-2">
              <input
                value={personalizada.nome}
                onChange={(e) => setPersonalizada((p) => ({ ...p, nome: e.target.value }))}
                placeholder="Nome (ex.: Elemental, Espírito)"
                maxLength={60}
                className="bg-table-deep border-panel-border text-text focus:border-primary min-w-0 flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none"
                aria-label="Nome da ficha"
              />
              <input
                value={personalizada.poder}
                onChange={(e) => setPersonalizada((p) => ({ ...p, poder: e.target.value }))}
                placeholder="P"
                inputMode="numeric"
                maxLength={3}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-12 rounded-md border px-2 py-1.5 text-center text-sm focus:outline-none"
                aria-label="Poder"
              />
              <span className="text-text-muted">/</span>
              <input
                value={personalizada.resistencia}
                onChange={(e) => setPersonalizada((p) => ({ ...p, resistencia: e.target.value }))}
                placeholder="R"
                inputMode="numeric"
                maxLength={3}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-12 rounded-md border px-2 py-1.5 text-center text-sm focus:outline-none"
                aria-label="Resistência"
              />
              <button
                type="submit"
                disabled={!personalizada.nome.trim()}
                className="bg-primary hover:bg-primary-hover rounded-md px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                Criar
              </button>
            </form>
          </section>

          <div className="border-panel-border border-b p-4">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
                <Search className="text-text-muted h-4 w-4" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar token por nome ou tipo (ex: 'Zombie', 't:goblin')..."
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border py-2 pl-10 pr-4 text-sm transition-colors focus:outline-none"
                autoFocus
              />
              {isSearching && (
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <Loader2 className="text-primary h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
          </div>

          <div className="p-4">
            {results.length === 0 && !isSearching ? (
              <div className="text-text-muted flex flex-col items-center py-8 text-center">
                <Ghost className="mb-2 h-10 w-10 opacity-20" />
                Nenhum token encontrado.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {results.map((card) => {
                  // Do nosso proxy, não do `image_uris` da resposta.
                  const imageUri = card.id ? cardImageUrl(card.id, 'normal') : null;
                  return (
                    <div
                      key={card.id}
                      className="group relative cursor-pointer"
                      onClick={() => handleCreate(card)}
                    >
                      <div className="group-hover:border-primary bg-table-deep flex aspect-[63/88] flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-transparent transition-colors">
                        {imageUri ? (
                          <img
                            src={imageUri}
                            alt={card.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="p-2 text-center">
                            <span className="text-xs font-bold">{card.name}</span>
                            <span className="text-text-muted block text-[10px]">
                              {card.type_line}
                            </span>
                          </div>
                        )}

                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                          {creatingId === card.id ? (
                            <Loader2 className="h-8 w-8 animate-spin text-white" />
                          ) : (
                            <div className="flex flex-col items-center text-white">
                              <Plus className="mb-1 h-8 w-8" />
                              <span className="bg-primary rounded px-2 py-1 text-xs font-bold">
                                {quantidade > 1 ? `Criar ${quantidade}` : 'Criar ficha'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
