'use client';

import { useState, useEffect, use } from 'react';
import { useAuthStore } from '../../../../store/auth.store';
import {
  ArrowLeft,
  Save,
  AlertCircle,
  LibraryBig,
  Trash2,
  Edit2,
  X,
  Check,
  LayoutGrid,
  List,
  Search as SearchIcon,
  Image as ImageIcon,
  Plus as PlusIcon,
  Minus as MinusIcon,
  Crown,
  Activity,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { ConfirmDialog, ToastHost, useToast } from '../../../../components/Toast';
import { CardSearch } from '../../../../deckbuilder/CardSearch';
import { PrintingPicker } from '../../../../deckbuilder/PrintingPicker';

export default function DeckBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isReadOnly = searchParams.get('mode') === 'view';
  const { accessToken } = useAuthStore();

  const [deck, setDeck] = useState<any>(null);
  const [rawText, setRawText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Estados de visualização
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');
  const [groupBy, setGroupBy] = useState<'type' | 'none'>('type');

  // Estados de edição de nome
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // Abas do painel esquerdo
  const [leftTab, setLeftTab] = useState<'search' | 'import'>('search');

  // Estado para impressão de carta
  const [editingPrintingCard, setEditingPrintingCard] = useState<any | null>(null);
  /**
   * `window.confirm` trava a aba inteira e é bloqueado dentro de iframe — a
   * remoção simplesmente não acontecia nesse caso, sem erro nenhum.
   */
  const [cartaParaRemover, setCartaParaRemover] = useState<string | null>(null);
  const avisar = useToast((s) => s.mostrar);

  useEffect(() => {
    fetchDeck();
  }, [id, accessToken]);

  async function fetchDeck() {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeck(data);
        setEditNameValue(data.name);
      } else {
        router.push('/dashboard/decks');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setIsImporting(true);
    setImportResult(null);

    try {
      const res = await fetch(`${API_URL}/decks/${id}/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ decklist: rawText }),
      });
      const data = await res.json();

      if (res.ok) {
        setImportResult({ success: true, count: data.imported, notFound: data.notFound || [] });
        setRawText('');
        fetchDeck();
      } else {
        setImportResult({ success: false, error: data.message });
      }
    } catch {
      setImportResult({ success: false, error: 'Falha na conexão com servidor' });
    } finally {
      setIsImporting(false);
    }
  }

  async function handleRenameDeck() {
    if (!editNameValue.trim() || editNameValue === deck.name) {
      setIsEditingName(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/decks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: editNameValue }),
      });
      if (res.ok) {
        setDeck({ ...deck, name: editNameValue });
        setIsEditingName(false);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleRemoveCard(cardId: string) {
    try {
      const res = await fetch(`${API_URL}/decks/${id}/cards/${cardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        await fetchDeck(); // Recarrega para atualizar a contagem total
        avisar('Carta removida do grimório.', 'sucesso');
      } else {
        avisar('Não foi possível remover a carta.', 'erro');
      }
    } catch (err) {
      console.error(err);
      avisar('Falha de conexão ao remover a carta.', 'erro');
    } finally {
      setCartaParaRemover(null);
    }
  }

  async function handleAddCard(scryfallId: string, quantity: number = 1) {
    try {
      const res = await fetch(`${API_URL}/decks/${id}/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ scryfallId, quantity, boardType: 'MAIN' }),
      });
      if (res.ok) {
        await fetchDeck();
      } else {
        avisar('Não foi possível adicionar a carta.', 'erro');
      }
    } catch (err) {
      console.error(err);
      avisar('Falha de conexão ao adicionar a carta.', 'erro');
    }
  }

  async function handleChangeQuantity(cardId: string, delta: number) {
    try {
      const res = await fetch(`${API_URL}/decks/${id}/cards/${cardId}/quantity`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ delta }),
      });
      if (res.ok) {
        await fetchDeck();
      } else {
        avisar('Não foi possível alterar a quantidade.', 'erro');
      }
    } catch (err) {
      console.error(err);
      avisar('Falha de conexão ao alterar a quantidade.', 'erro');
    }
  }

  async function handleToggleBoardType(cardId: string, currentBoardType: string) {
    const newBoardType = currentBoardType === 'COMMANDER' ? 'MAIN' : 'COMMANDER';
    try {
      const res = await fetch(`${API_URL}/decks/${id}/cards/${cardId}/board-type`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ boardType: newBoardType }),
      });
      if (res.ok) {
        await fetchDeck();
      }
    } catch (err) {
      console.error(err);
      avisar('Não foi possível definir como comandante.', 'erro');
    }
  }

  function getGroupedCards() {
    if (!deck?.cards) return {};
    if (groupBy === 'none') return { 'Todas as Cartas': deck.cards };

    const groups: Record<string, any[]> = {};
    deck.cards.forEach((card: any) => {
      let key = 'Outros';
      const t = card.typeLine?.toLowerCase() || '';

      if (card.boardType === 'COMMANDER') key = 'Comandante';
      else if (t.includes('creature')) key = 'Criaturas';
      else if (t.includes('land')) key = 'Terrenos';
      else if (t.includes('artifact')) key = 'Artefatos';
      else if (t.includes('enchantment')) key = 'Encantamentos';
      else if (t.includes('planeswalker')) key = 'Planeswalkers';
      else if (t.includes('instant') || t.includes('sorcery')) key = 'Mágicas';

      if (!groups[key]) groups[key] = [];
      groups[key]!.push(card);
    });

    // Sort groups so Comandante is first
    const sortedGroups: Record<string, any[]> = {};
    if (groups['Comandante']) sortedGroups['Comandante'] = groups['Comandante']!;
    Object.keys(groups)
      .sort()
      .forEach((k) => {
        if (k !== 'Comandante') sortedGroups[k] = groups[k]!;
      });

    return sortedGroups;
  }

  function calculatePowerBracket(cards: any[]) {
    if (!cards || cards.length === 0) return { label: 'Desconhecido', color: 'text-text-muted' };

    let score = 0;
    const cEDHCards = [
      'Mana Crypt',
      "Gaea's Cradle",
      'Underworld Breach',
      "Thassa's Oracle",
      'Demonic Tutor',
      'Vampiric Tutor',
      'Force of Will',
      'Fierce Guardianship',
      'Jeweled Lotus',
      'Mox Diamond',
      'Chrome Mox',
      'Dockside Extortionist',
      'Deflecting Swat',
      'Imperial Seal',
      'Timetwister',
      "Lion's Eye Diamond",
    ];
    const highPowerCards = [
      'Sol Ring',
      'Mana Vault',
      'Rhystic Study',
      'Mystic Remora',
      'Sylvan Library',
      'Cyclonic Rift',
      'Smothering Tithe',
      "Teferi's Protection",
      'Craterhoof Behemoth',
    ];

    cards.forEach((c) => {
      const name = c.name || '';
      if (cEDHCards.some((cedh) => name.includes(cedh))) score += 3;
      else if (highPowerCards.some((hp) => name.includes(hp))) score += 1;
    });

    if (score >= 10) return { label: 'Bracket 5 (cEDH / Máximo)', color: 'text-[#ef4444]' }; // Red
    if (score >= 7) return { label: 'Bracket 4 (High Power)', color: 'text-[#f97316]' }; // Orange
    if (score >= 4) return { label: 'Bracket 3 (Mid-High)', color: 'text-[#eab308]' }; // Yellow
    if (score >= 2) return { label: 'Bracket 2 (Mid Power)', color: 'text-[#84cc16]' }; // Lime
    return { label: 'Bracket 1 (Low Power / Casual)', color: 'text-[#22c55e]' }; // Green
  }

  if (!deck) {
    return <div className="text-text-muted animate-pulse">Invocando grimório...</div>;
  }

  const groupedCards = getGroupedCards();
  const totalPrice = deck.cards
    ? deck.cards
        .reduce((acc: number, c: any) => acc + (parseFloat(c.priceUsd) || 0) * c.quantity, 0)
        .toFixed(2)
    : '0.00';
  const bracket = calculatePowerBracket(deck.cards);

  return (
    <>
      <div className="mx-auto max-w-6xl animate-[fadeIn_0.3s_ease-out]">
        <header className="mb-8">
          <button
            onClick={() => router.push('/dashboard/decks')}
            className="text-text-muted hover:text-primary mb-4 flex items-center gap-2 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar aos Decks
          </button>

          <div className="mb-2 flex items-center gap-3">
            <LibraryBig className="text-primary h-8 w-8 flex-shrink-0" />
            {isEditingName ? (
              <div className="flex max-w-md flex-1 items-center gap-2">
                <input
                  type="text"
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  autoFocus
                  className="bg-table-deep border-primary text-text flex-1 rounded border px-3 py-1 text-2xl font-bold focus:outline-none"
                />
                <button
                  onClick={handleRenameDeck}
                  className="bg-success rounded p-2 text-white hover:brightness-110"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setIsEditingName(false);
                    setEditNameValue(deck.name);
                  }}
                  className="bg-danger rounded p-2 text-white hover:brightness-110"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1 className="text-text group flex items-center gap-3 text-3xl font-bold">
                {deck.name}
                {!isReadOnly && (
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="text-text-muted hover:text-primary p-1 opacity-0 transition-all group-hover:opacity-100"
                  >
                    <Edit2 className="h-5 w-5" />
                  </button>
                )}
              </h1>
            )}
          </div>

          <div className="text-text-muted flex flex-wrap gap-4 text-sm">
            <span className="bg-panel border-panel-border rounded border px-2 py-1">
              {deck.cardCount} Cartas
            </span>
            <span className="bg-panel border-panel-border rounded border px-2 py-1">
              ${totalPrice} USD
            </span>
            <span className="bg-panel border-panel-border rounded border px-2 py-1">
              Formato: <span className="text-text font-bold uppercase">{deck.formatId}</span>
            </span>
            <span
              className={`bg-panel border-panel-border flex items-center gap-2 rounded border px-2 py-1 font-bold ${bracket.color}`}
            >
              <Activity className="h-4 w-4" /> {bracket.label}
            </span>
            <span className="bg-panel border-panel-border rounded border px-2 py-1">
              Criado em {new Date(deck.createdAt).toLocaleDateString()}
            </span>
          </div>
        </header>

        <div className="mb-6 flex gap-4">
          <div className="bg-panel border-panel-border flex gap-1 rounded-md border p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${viewMode === 'list' ? 'bg-primary text-white shadow' : 'text-text-muted hover:text-text hover:bg-table-deep'}`}
            >
              <List className="h-4 w-4" /> Edição em Lista
            </button>
            <button
              onClick={() => setViewMode('gallery')}
              className={`flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-medium transition-colors ${viewMode === 'gallery' ? 'bg-primary text-white shadow' : 'text-text-muted hover:text-text hover:bg-table-deep'}`}
            >
              <LayoutGrid className="h-4 w-4" /> Galeria Visual
            </button>
          </div>

          {viewMode === 'gallery' && (
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as any)}
              className="bg-panel border-panel-border text-text focus:border-primary rounded-md border px-4 py-2 text-sm focus:outline-none"
            >
              <option value="type">Agrupar por Tipo</option>
              <option value="none">Sem Agrupamento</option>
            </select>
          )}
        </div>

        {viewMode === 'list' ? (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {!isReadOnly && (
              <div className="lg:col-span-1">
                <div className="bg-panel border-panel-border flex h-full flex-col rounded-xl border p-6 shadow-lg">
                  <div className="border-panel-border mb-6 flex gap-2 border-b pb-2">
                    <button
                      onClick={() => setLeftTab('search')}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-t-md py-2 text-sm font-medium transition-colors ${leftTab === 'search' ? 'text-primary border-primary border-b-2' : 'text-text-muted hover:text-text'}`}
                    >
                      <SearchIcon className="h-4 w-4" /> Buscar Cartas
                    </button>
                    <button
                      onClick={() => setLeftTab('import')}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-t-md py-2 text-sm font-medium transition-colors ${leftTab === 'import' ? 'text-primary border-primary border-b-2' : 'text-text-muted hover:text-text'}`}
                    >
                      <Save className="h-4 w-4" /> Importação
                    </button>
                  </div>

                  {leftTab === 'search' ? (
                    <div className="flex min-h-[400px] flex-1 flex-col overflow-hidden">
                      <CardSearch onAddCard={handleAddCard} />
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col">
                      <p className="text-text-muted mb-4 text-sm">
                        Cole sua lista para substituir o deck atual ou iniciar do zero.
                      </p>
                      <form onSubmit={handleImport} className="flex flex-1 flex-col">
                        <textarea
                          value={rawText}
                          onChange={(e) => setRawText(e.target.value)}
                          disabled={isImporting}
                          placeholder="Exemplo:\n1 Sol Ring\n1x Mana Crypt\n4 Lightning Bolt"
                          className="bg-table-deep border-panel-border text-text focus:border-primary mb-4 min-h-[300px] w-full flex-1 resize-none rounded-md border p-4 font-mono text-sm transition-colors focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={isImporting || !rawText.trim()}
                          className="bg-primary hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-md py-3 font-medium text-white transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Save className="h-5 w-5" />
                          {isImporting ? 'Lendo Runas na Scryfall...' : 'Substituir por Importação'}
                        </button>
                      </form>

                      {importResult && (
                        <div
                          className={`mt-4 rounded-md border p-4 text-sm ${importResult.success ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'}`}
                        >
                          {importResult.success ? (
                            <>
                              <p className="mb-1 font-semibold">
                                ✓ {importResult.count} cartas únicas importadas.
                              </p>
                              {importResult.notFound?.length > 0 && (
                                <div className="text-warning mt-2">
                                  <p className="font-semibold">⚠️ Não encontradas:</p>
                                  <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-4 text-xs">
                                    {importResult.notFound.map((name: string, i: number) => (
                                      <li key={i}>{name}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-5 w-5" />
                              <span>{importResult.error}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Painel Direito: Cartas (List) */}
            <div className={isReadOnly ? 'lg:col-span-3' : 'lg:col-span-2'}>
              <div className="bg-panel border-panel-border flex h-full flex-col rounded-xl border p-6 shadow-lg">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-text text-lg font-semibold">Lista de Cartas</h2>
                  <span className="text-text-muted text-sm font-medium">
                    {deck.cards?.length || 0} Cartas Únicas
                  </span>
                </div>

                <div className="mb-4 space-y-2">
                  {deck.cardCount !== 100 && deck.cardCount > 0 && (
                    <div className="bg-warning/10 border-warning/30 text-warning flex items-center gap-2 rounded-md border p-3 text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        Seu deck possui <strong>{deck.cardCount}</strong> cartas. O formato
                        Commander exige exatas 100.
                      </span>
                    </div>
                  )}
                  {deck.cards?.some((c: any) => c.isBanned) && (
                    <div className="bg-danger/10 border-danger/30 text-danger flex items-center gap-2 rounded-md border p-3 text-sm">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>
                        Atenção: Este grimório contém cartas <strong>Banidas</strong> no formato
                        Commander.
                      </span>
                    </div>
                  )}
                </div>

                {deck.cards?.length > 0 ? (
                  <div className="min-h-[400px] flex-1 space-y-2 overflow-y-auto pr-2">
                    {deck.cards
                      .sort((a: any, b: any) => {
                        if (a.boardType === 'COMMANDER' && b.boardType !== 'COMMANDER') return -1;
                        if (b.boardType === 'COMMANDER' && a.boardType !== 'COMMANDER') return 1;
                        return a.name.localeCompare(b.name);
                      })
                      .map((card: any) => (
                        <div
                          key={card.id}
                          className={`hover:border-primary group flex items-center justify-between rounded-lg border p-3 transition-colors ${card.boardType === 'COMMANDER' ? 'bg-primary/5 border-primary/30' : 'bg-table-deep border-panel-border'}`}
                        >
                          <div
                            className="flex flex-1 cursor-pointer items-center gap-3 overflow-hidden"
                            onClick={() => !isReadOnly && setEditingPrintingCard(card)}
                          >
                            <span className="text-primary w-6 text-right font-bold">
                              {card.quantity}x
                            </span>
                            <div className="flex flex-1 flex-col truncate">
                              <span
                                className={`flex items-center gap-2 truncate text-sm font-semibold ${card.isBanned ? 'text-danger line-through' : card.boardType === 'COMMANDER' ? 'text-primary' : 'text-text'} group-hover:text-primary transition-colors`}
                              >
                                {card.name || 'Resolvendo...'}
                                {card.boardType === 'COMMANDER' && (
                                  <Crown className="text-primary h-3.5 w-3.5" />
                                )}
                                {card.isBanned && (
                                  <span className="bg-danger rounded px-1.5 py-0.5 text-[10px] uppercase text-white">
                                    Banida
                                  </span>
                                )}
                                <ImageIcon className="text-text-faint h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                              </span>
                              <span className="text-text-faint truncate text-xs">
                                {card.typeLine}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-3">
                            <span className="text-primary bg-primary/10 rounded px-2 py-1 font-mono text-[10px]">
                              [{card.set}]
                            </span>
                            {!isReadOnly && (
                              <div className="bg-table-deep border-panel-border flex items-center gap-1 overflow-hidden rounded border">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleBoardType(card.id, card.boardType);
                                  }}
                                  className={`p-1 transition-colors ${card.boardType === 'COMMANDER' ? 'bg-primary text-white' : 'text-text-muted hover:text-primary hover:bg-primary/10'}`}
                                  title={
                                    card.boardType === 'COMMANDER'
                                      ? 'Remover do Comando'
                                      : 'Tornar Comandante'
                                  }
                                >
                                  <Crown className="h-3.5 w-3.5" />
                                </button>
                                <div className="bg-panel-border mx-0.5 h-4 w-[1px]"></div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleChangeQuantity(card.id, -1);
                                  }}
                                  className="hover:bg-danger/20 hover:text-danger text-text-muted p-1 transition-colors"
                                  title="Diminuir"
                                >
                                  <MinusIcon className="h-3 w-3" />
                                </button>
                                <span className="text-text w-4 px-1 text-center text-xs font-bold">
                                  {card.quantity}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleChangeQuantity(card.id, 1);
                                  }}
                                  className="hover:bg-success/20 hover:text-success text-text-muted p-1 transition-colors"
                                  title="Aumentar"
                                >
                                  <PlusIcon className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveCard(card.id);
                                  }}
                                  className="bg-danger/10 text-danger hover:bg-danger ml-1 p-1 transition-colors hover:text-white"
                                  title="Remover Todas"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="border-panel-border text-text-muted flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                    <LibraryBig className="mb-3 h-10 w-10 opacity-50" />
                    <p>Nenhuma carta neste grimório.</p>
                    <p className="mt-1 text-xs">
                      Cole sua lista de texto no painel à esquerda para importar as cartas.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Galeria Visual */
          <div className="bg-panel border-panel-border min-h-[500px] rounded-xl border p-6 shadow-lg">
            {Object.entries(groupedCards).map(([groupName, cards]) => (
              <div key={groupName} className="mb-8">
                <h3 className="text-text border-panel-border mb-4 flex items-center justify-between border-b pb-2 text-xl font-bold">
                  <span className="flex items-center gap-2">
                    {groupName === 'Comandante' && <Crown className="text-primary h-5 w-5" />}
                    {groupName}
                  </span>
                  <span className="text-text-muted bg-table-deep rounded px-2 py-1 text-sm font-medium">
                    {cards.reduce((acc: number, c: any) => acc + c.quantity, 0)} Cartas
                  </span>
                </h3>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {cards.map((card: any) => (
                    <div
                      key={card.id}
                      className="group/card relative"
                      onClick={() => !isReadOnly && setEditingPrintingCard(card)}
                    >
                      <img
                        src={card.imageNormal || ''}
                        alt={card.name}
                        className={`w-full rounded-lg border-2 shadow-md transition-colors ${card.boardType === 'COMMANDER' ? 'border-primary shadow-primary/30' : 'group-hover/card:border-primary border-transparent'}`}
                        loading="lazy"
                      />
                      <div
                        className={`absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold shadow-lg ${card.boardType === 'COMMANDER' ? 'bg-primary border-primary text-white' : 'bg-panel border-panel-border'}`}
                      >
                        {card.quantity}
                      </div>
                      {card.boardType === 'COMMANDER' && (
                        <div className="bg-primary border-primary absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-lg">
                          <Crown className="h-3.5 w-3.5" />
                        </div>
                      )}
                      {!isReadOnly && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60 opacity-0 backdrop-blur-[2px] transition-opacity group-hover/card:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleBoardType(card.id, card.boardType);
                            }}
                            className={`mb-2 flex items-center gap-1 rounded px-3 py-1.5 text-xs font-bold shadow-lg transition-colors ${card.boardType === 'COMMANDER' ? 'bg-danger/80 hover:bg-danger text-white' : 'bg-primary/80 hover:bg-primary text-white'}`}
                            title={
                              card.boardType === 'COMMANDER'
                                ? 'Remover do Comando'
                                : 'Tornar Comandante'
                            }
                          >
                            <Crown className="h-3 w-3" />{' '}
                            {card.boardType === 'COMMANDER' ? 'Despromover' : 'Comandante'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveCard(card.id);
                            }}
                            className="bg-danger/80 hover:bg-danger mb-2 rounded-full p-2 text-white shadow-lg transition-all hover:scale-110"
                            title="Remover carta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <span className="flex items-center gap-1 rounded bg-black/80 px-2 py-1 text-[10px] font-bold text-white">
                            <ImageIcon className="h-3 w-3" /> Mudar Arte
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {deck.cards?.length === 0 && (
              <div className="text-text-muted flex flex-col items-center justify-center p-12 text-center">
                <LibraryBig className="mb-3 h-12 w-12 opacity-50" />
                <p>Nenhuma carta neste grimório para exibir.</p>
              </div>
            )}
          </div>
        )}

        {editingPrintingCard && (
          <PrintingPicker
            card={editingPrintingCard}
            deckId={deck.id}
            accessToken={accessToken!}
            onClose={() => setEditingPrintingCard(null)}
            onSuccess={() => {
              fetchDeck();
              setEditingPrintingCard(null);
            }}
          />
        )}
      </div>

      <ConfirmDialog
        aberto={cartaParaRemover !== null}
        titulo="Remover carta do grimório?"
        descricao="A carta sai da lista. Você pode adicioná-la de novo pela busca."
        rotuloConfirmar="Remover"
        perigo
        onConfirmar={() => cartaParaRemover && handleRemoveCard(cartaParaRemover)}
        onCancelar={() => setCartaParaRemover(null)}
      />
      <ToastHost />
    </>
  );
}
