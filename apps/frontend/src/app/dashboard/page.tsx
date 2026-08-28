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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ deckId: selectedDeckId })
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
    <div className="max-w-6xl mx-auto animate-[fadeIn_0.3s_ease-out]">
      
      {/* Header do Saguão */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-text mb-2">Bem-vindo à Taverna, {user?.username}</h1>
        <p className="text-text-muted">A mesa está limpa. Suas cartas aguardam comandos.</p>
      </header>

      {/* Ações Principais (Entrar na Mesa) */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Card: Criar Nova Sala */}
        <div 
          onClick={() => handleOpenModal('CREATE')}
          className="bg-panel border border-panel-border rounded-xl p-6 hover:border-primary transition-colors group cursor-pointer relative overflow-hidden shadow-lg"
        >
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors" />
          <div className="relative z-10 flex flex-col h-full pointer-events-none">
            <div className="w-12 h-12 rounded-lg bg-table-deep border border-panel-border flex items-center justify-center mb-4">
              <Play className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-text mb-2">Criar Mesa Privada</h2>
            <p className="text-sm text-text-muted mb-6 flex-1">
              Gere uma sala encriptada para você e seus amigos. Ninguém entra sem o convite.
            </p>
            <button className="w-fit px-5 py-2.5 bg-primary text-white font-medium rounded-md shadow-md pointer-events-auto">
              Criar Agora
            </button>
          </div>
        </div>

        {/* Card: Entrar via Código */}
        <div className="bg-panel border border-panel-border rounded-xl p-6 hover:border-success transition-colors group relative overflow-hidden shadow-lg flex flex-col justify-between">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-success/10 rounded-full blur-3xl group-hover:bg-success/20 transition-colors pointer-events-none" />
          
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-lg bg-table-deep border border-panel-border flex items-center justify-center mb-4">
              <KeyRound className="w-6 h-6 text-success" />
            </div>
            <h2 className="text-xl font-bold text-text mb-2">Entrar com Código</h2>
            <p className="text-sm text-text-muted mb-4">
              Possui um código de taverna? Insira-o abaixo para juntar-se instantaneamente.
            </p>
          </div>

          <div className="relative z-10 flex gap-2">
            <input 
              type="text" 
              placeholder="EX: DRG-402"
              value={roomCodeInput}
              onChange={e => setRoomCodeInput(e.target.value)}
              className="flex-1 bg-table-deep border border-panel-border rounded-md px-4 py-2.5 text-text focus:outline-none focus:border-success uppercase font-mono tracking-widest"
            />
            <button 
              onClick={() => handleOpenModal('JOIN')}
              className="px-5 py-2.5 bg-success text-white font-medium rounded-md hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center gap-2"
            >
              Conectar
            </button>
          </div>
        </div>
      </section>

      {/* Seção de Decks (Carrossel) */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Library className="w-6 h-6 text-text" />
            <h2 className="text-xl font-bold text-text">Seu Grimório (Decks)</h2>
          </div>
          <span className="text-xs font-semibold text-text-muted bg-panel border border-panel-border px-3 py-1 rounded-full">
            {myDecks.length} DE 100
          </span>
        </div>

        {myDecks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
             {myDecks.map(deck => (
               <div key={deck.id} className="bg-panel border border-panel-border p-4 rounded-xl flex flex-col">
                 <h3 className="text-lg font-bold text-text mb-1">{deck.name}</h3>
                 <span className="text-sm text-text-muted">Cartas: {deck.cardCount ?? 0}/100</span>
               </div>
             ))}
          </div>
        ) : (
          <div className="w-full h-48 bg-panel/50 border border-dashed border-panel-border rounded-xl flex flex-col items-center justify-center text-center p-6">
            <div className="w-12 h-12 rounded-full bg-table-deep flex items-center justify-center mb-3">
              <Plus className="w-6 h-6 text-text-muted" />
            </div>
            <h3 className="text-text font-medium mb-1">Grimório Vazio</h3>
            <p className="text-sm text-text-muted max-w-sm">
              Você ainda não forjou nenhum deck. Vá até a seção "Meus Decks" para importar cartas.
            </p>
          </div>
        )}
      </section>

      {/* Modal de Conexão */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-panel border border-panel-border rounded-xl p-6 w-full max-w-md shadow-2xl scale-[1] animate-[popIn_0.2s_ease-out]">
            <h2 className="text-xl font-bold text-text mb-1">
              {modalAction === 'CREATE' ? 'Forjar Nova Sala' : 'Entrar na Sala'}
            </h2>
            <p className="text-sm text-text-muted mb-6">
              Escolha qual grimório você levará para esta batalha. Lembre-se que decks com cartas banidas serão bloqueados pelo juiz.
            </p>

            <div className="mb-6">
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">Selecione seu Deck</label>
              <select 
                value={selectedDeckId}
                onChange={e => setSelectedDeckId(e.target.value)}
                className="w-full bg-table-deep border border-panel-border text-text rounded-md px-4 py-3 focus:outline-none focus:border-primary"
              >
                <option value="" disabled>-- Escolha um grimório --</option>
                {myDecks.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.cardCount ?? 0} cartas)</option>
                ))}
              </select>
            </div>

            {modalAction === 'CREATE' && (
              <div className="mb-6 flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-text-muted uppercase mb-2">Jogadores</label>
                  <select 
                    value={maxClients}
                    onChange={e => setMaxClients(Number(e.target.value))}
                    className="w-full bg-table-deep border border-panel-border text-text rounded-md px-4 py-3 focus:outline-none focus:border-primary"
                  >
                    <option value={2}>2 Jogadores</option>
                    <option value={3}>3 Jogadores</option>
                    <option value={4}>4 Jogadores</option>
                    <option value={5}>5 Jogadores</option>
                    <option value={6}>6 Jogadores</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-bold text-text-muted uppercase mb-2">Formato</label>
                  <select 
                    value={gameType}
                    onChange={e => setGameType(e.target.value)}
                    className="w-full bg-table-deep border border-panel-border text-text rounded-md px-4 py-3 focus:outline-none focus:border-primary"
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
              <div className="mb-6 p-3 bg-danger/10 border border-danger/30 text-danger rounded-md text-sm font-medium">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-3 justify-end mt-4">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-transparent text-text-muted hover:text-text font-medium rounded-md transition-colors"
                disabled={isConnecting}
              >
                Cancelar
              </button>
              <button 
                onClick={handleConnect}
                disabled={isConnecting || !selectedDeckId}
                className="px-6 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary-hover active:scale-95 transition-all shadow-md disabled:opacity-50 flex items-center gap-2"
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
