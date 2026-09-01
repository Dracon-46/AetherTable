'use client';

import { useState, useEffect } from 'react';
import { Play, KeyRound, Library, Plus } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { API_URL } from '@/lib/api';

// Tipagem básica de um deck real no futuro
interface Deck {
  id: string;
  name: string;
  commander: string;
  colors: string[];
  /** Contagem desnormalizada vinda da API (docs/modelo_de_dados.md §3.3). */
  cardCount?: number;
}

export default function DashboardPage() {
  const { user, accessToken } = useAuthStore();

  const [myDecks, setMyDecks] = useState<Deck[]>([]);
  const [, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchDecks() {
      if (!accessToken) return;
      try {
        const res = await fetch(`${API_URL}/decks`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setMyDecks(data);
        }
      } catch (err) {
        console.error('Falha ao buscar decks', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchDecks();
  }, [accessToken]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [maxClients, setMaxClients] = useState(4);
  const [gameType, setGameType] = useState('COMMANDER');

  // Funcão para abrir modal
  const handleOpenModal = (action: 'CREATE' | 'JOIN') => {
    setModalAction(action);
    setErrorMsg('');
    setIsModalOpen(true);
    // `noUncheckedIndexedAccess` torna myDecks[0] possivelmente undefined mesmo
    // depois do length > 0 — o TS não correlaciona as duas coisas.
    const primeiro = myDecks[0];
    if (primeiro && !selectedDeckId) {
      setSelectedDeckId(primeiro.id);
    }
  };

  const handleConnect = async () => {
    if (!selectedDeckId) {
      setErrorMsg('Selecione um grimório primeiro.');
      return;
    }

    if (modalAction === 'JOIN' && !roomCodeInput) {
      setErrorMsg('Digite o código da taverna.');
      return;
    }

    setIsConnecting(true);
    setErrorMsg('');

    try {
      let code = roomCodeInput.toUpperCase();

      // Se for CREATE, chamamos a rota create primeiro
      if (modalAction === 'CREATE') {
        const createRes = await fetch(`${API_URL}/matches/create`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!createRes.ok) throw new Error('Falha ao criar sala.');
        const createData = await createRes.json();
        code = createData.roomCode;
      }

      // Em ambos os casos, chamamos o JOIN para validar o deck e pegar o seatToken
      const joinRes = await fetch(`${API_URL}/matches/${code}/join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deckId: selectedDeckId }),
      });

      const joinData = await joinRes.json();

      if (!joinRes.ok) {
        // Exibe o erro da trava de validação!
        throw new Error(joinData.message || 'Falha ao entrar na sala.');
      }

      // Sucesso! Temos o seatToken. Vamos para a Mesa de Jogo!
      // Passaremos o token na URL ou em estado global. Para o MVP, URL query param.
      let redirectUrl = `/play/${code}?token=${joinData.seatToken}`;
      if (modalAction === 'CREATE') {
        redirectUrl += `&maxClients=${maxClients}&gameType=${gameType}`;
      }
      window.location.href = redirectUrl;
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro desconhecido ao conectar.');
      setIsConnecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl animate-[fadeIn_0.3s_ease-out]">
      {/* Header do Saguão */}
      <header className="mb-10">
        <h1 className="text-text mb-2 text-3xl font-bold">Bem-vindo à Taverna, {user?.username}</h1>
        <p className="text-text-muted">A mesa está limpa. Suas cartas aguardam comandos.</p>
      </header>

      {/* Ações Principais (Entrar na Mesa) */}
      <section className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Card: Criar Nova Sala */}
        <div
          onClick={() => handleOpenModal('CREATE')}
          className="bg-panel border-panel-border hover:border-primary group relative cursor-pointer overflow-hidden rounded-xl border p-6 shadow-lg transition-colors"
        >
          <div className="bg-primary/10 group-hover:bg-primary/20 absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl transition-colors" />
          <div className="pointer-events-none relative z-10 flex h-full flex-col">
            <div className="bg-table-deep border-panel-border mb-4 flex h-12 w-12 items-center justify-center rounded-lg border">
              <Play className="text-primary h-6 w-6" />
            </div>
            <h2 className="text-text mb-2 text-xl font-bold">Criar Mesa Privada</h2>
            <p className="text-text-muted mb-6 flex-1 text-sm">
              Gere uma sala encriptada para você e seus amigos. Ninguém entra sem o convite.
            </p>
            <button className="bg-primary pointer-events-auto w-fit rounded-md px-5 py-2.5 font-medium text-white shadow-md">
              Criar Agora
            </button>
          </div>
        </div>

        {/* Card: Entrar via Código */}
        <div className="bg-panel border-panel-border hover:border-success group relative flex flex-col justify-between overflow-hidden rounded-xl border p-6 shadow-lg transition-colors">
          <div className="bg-success/10 group-hover:bg-success/20 pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl transition-colors" />

          <div className="relative z-10">
            <div className="bg-table-deep border-panel-border mb-4 flex h-12 w-12 items-center justify-center rounded-lg border">
              <KeyRound className="text-success h-6 w-6" />
            </div>
            <h2 className="text-text mb-2 text-xl font-bold">Entrar com Código</h2>
            <p className="text-text-muted mb-4 text-sm">
              Possui um código de taverna? Insira-o abaixo para juntar-se instantaneamente.
            </p>
          </div>

          <div className="relative z-10 flex gap-2">
            <input
              type="text"
              placeholder="EX: DRG-402"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              className="bg-table-deep border-panel-border text-text focus:border-success flex-1 rounded-md border px-4 py-2.5 font-mono uppercase tracking-widest focus:outline-none"
            />
            <button
              onClick={() => handleOpenModal('JOIN')}
              className="bg-success flex items-center gap-2 rounded-md px-5 py-2.5 font-medium text-white shadow-md transition-all hover:brightness-110 active:scale-95"
            >
              Conectar
            </button>
          </div>
        </div>
      </section>

      {/* Seção de Decks (Carrossel) */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Library className="text-text h-6 w-6" />
            <h2 className="text-text text-xl font-bold">Seu Grimório (Decks)</h2>
          </div>
          <span className="text-text-muted bg-panel border-panel-border rounded-full border px-3 py-1 text-xs font-semibold">
            {myDecks.length} DE 100
          </span>
        </div>

        {myDecks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 pb-4 md:grid-cols-2 lg:grid-cols-3">
            {myDecks.map((deck) => (
              <div
                key={deck.id}
                className="bg-panel border-panel-border flex flex-col rounded-xl border p-4"
              >
                <h3 className="text-text mb-1 text-lg font-bold">{deck.name}</h3>
                <span className="text-text-muted text-sm">Cartas: {deck.cardCount ?? 0}/100</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-panel/50 border-panel-border flex h-48 w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
            <div className="bg-table-deep mb-3 flex h-12 w-12 items-center justify-center rounded-full">
              <Plus className="text-text-muted h-6 w-6" />
            </div>
            <h3 className="text-text mb-1 font-medium">Grimório Vazio</h3>
            <p className="text-text-muted max-w-sm text-sm">
              Você ainda não forjou nenhum deck. Vá até a seção "Meus Decks" para importar cartas.
            </p>
          </div>
        )}
      </section>

      {/* Modal de Conexão */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex animate-[fadeIn_0.2s_ease-out] items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-panel border-panel-border w-full max-w-md scale-[1] animate-[popIn_0.2s_ease-out] rounded-xl border p-6 shadow-2xl">
            <h2 className="text-text mb-1 text-xl font-bold">
              {modalAction === 'CREATE' ? 'Forjar Nova Sala' : 'Entrar na Sala'}
            </h2>
            <p className="text-text-muted mb-6 text-sm">
              Escolha qual grimório você levará para esta batalha. Lembre-se que decks com cartas
              banidas serão bloqueados pelo juiz.
            </p>

            <div className="mb-6">
              <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                Selecione seu Deck
              </label>
              <select
                value={selectedDeckId}
                onChange={(e) => setSelectedDeckId(e.target.value)}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
              >
                <option value="" disabled>
                  -- Escolha um grimório --
                </option>
                {myDecks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount ?? 0} cartas)
                  </option>
                ))}
              </select>
            </div>

            {modalAction === 'CREATE' && (
              <div className="mb-6 flex gap-4">
                <div className="flex-1">
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Jogadores
                  </label>
                  <select
                    value={maxClients}
                    onChange={(e) => setMaxClients(Number(e.target.value))}
                    className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                  >
                    <option value={2}>2 Jogadores</option>
                    <option value={3}>3 Jogadores</option>
                    <option value={4}>4 Jogadores</option>
                    <option value={5}>5 Jogadores</option>
                    <option value={6}>6 Jogadores</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Formato
                  </label>
                  <select
                    value={gameType}
                    onChange={(e) => setGameType(e.target.value)}
                    className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                  >
                    <option value="COMMANDER">Commander</option>
                    <option value="STANDARD">Standard</option>
                    <option value="MODERN">Modern</option>
                    <option value="PAUPER">Pauper</option>
                  </select>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="bg-danger/10 border-danger/30 text-danger mb-6 rounded-md border p-3 text-sm font-medium">
                {errorMsg}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-text-muted hover:text-text rounded-md bg-transparent px-4 py-2 font-medium transition-colors"
                disabled={isConnecting}
              >
                Cancelar
              </button>
              <button
                onClick={handleConnect}
                disabled={isConnecting || !selectedDeckId}
                className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-6 py-2 font-medium text-white shadow-md transition-all active:scale-95 disabled:opacity-50"
              >
                {isConnecting ? 'Conectando...' : 'Entrar na Mesa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
