'use client';

import { useState } from 'react';
import { Play, KeyRound, Library, Plus, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '../../store/auth.store';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useListaDeDecks } from '../../deckbuilder/useDecks';
import { FORMATOS_JOGAVEIS, acharFormato } from '@aethertable/shared-types';

export default function DashboardPage() {
  const { user } = useAuthStore();

  /**
   * A lista vem do CACHE compartilhado com `/dashboard/decks`.
   *
   * Esta tela tinha o próprio `useEffect` + `fetch` + `useState` para buscar
   * exatamente a mesma coisa que a tela de grimórios busca. Alternar entre as
   * duas fazia duas requisições idênticas, sempre — e a lista aqui alimenta o
   * seletor de deck do modal, então ela era refeita também no meio do fluxo de
   * entrar numa mesa.
   */
  const { data: decks, isPending: carregandoDecks } = useListaDeDecks();
  const myDecks = decks ?? [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  /**
   * ─── O FORMATO DA MESA VEM DO CATÁLOGO, E ELE DECIDE A CONTAGEM ───────────
   *
   * Este seletor tinha quatro formatos escritos à mão em MAIÚSCULAS
   * (`COMMANDER`, `STANDARD`, `MODERN`, `PAUPER`), enquanto o deck usa ids em
   * minúsculas e a validação do backend conhecia oito. Criar uma mesa de
   * "TIMELESS" era impossível; criar uma de "PAUPER" mandava uma string que a
   * validação de formato do deck não reconhecia.
   *
   * E a contagem de jogadores era uma lista fixa de 2 a 8 para qualquer
   * formato: dava para abrir uma mesa de Duel Commander com seis pessoas, ou
   * um teste solo com quatro.
   */
  const [gameType, setGameType] = useState('commander');
  const formato = acharFormato(gameType);
  const [maxClients, setMaxClients] = useState(formato.jogadores.padrao);

  /**
   * Abre o modal de conexão.
   *
   * NÃO pré-seleciona deck. Ele selecionava o primeiro grimório da conta em
   * silêncio — e desde que a escolha passou para a sala de espera, isso ficou
   * contraditório: a opção do seletor dizia "escolher na sala de espera"
   * enquanto o valor real já era o primeiro deck da lista. O jogador entrava na
   * mesa com um baralho que nunca escolheu, e o botão "Estou pronto" do lobby
   * já vinha liberado — encobrindo justamente o passo que a mudança criou.
   *
   * Escolher aqui continua valendo; o que não vale é escolher POR ele.
   */
  const handleOpenModal = (action: 'CREATE' | 'JOIN') => {
    setModalAction(action);
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleConnect = async () => {
    /**
     * O GRIMÓRIO DEIXOU DE SER OBRIGATÓRIO AQUI.
     *
     * Ele é escolhido na sala de espera, onde dá para ver quem sentou e qual
     * formato a mesa está jogando antes de decidir. Escolher já neste modal
     * continua valendo — quem sabe com que deck vai jogar não deve ser obrigado
     * a decidir duas vezes — e nesse caso a validação de formato roda aqui, na
     * API, antes de qualquer conexão.
     */
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
        const criada = await api<{ roomCode: string }>('/matches/create', { method: 'POST' });
        code = criada.roomCode;
      }

      // Em ambos os casos, o JOIN valida o deck e devolve o seatToken.
      // Sem deck: o passe sai sem `deckId` e o jogador escolhe no lobby.
      const passe = await api<{ seatToken: string }>(`/matches/${code}/join`, {
        method: 'POST',
        body: selectedDeckId ? { deckId: selectedDeckId } : {},
      });

      let destino = `/play/${code}?token=${passe.seatToken}`;
      if (modalAction === 'CREATE') {
        destino += `&maxClients=${maxClients}&gameType=${gameType}`;
      }

      /**
       * ─── ISTO PRECISA SER UMA CARGA COMPLETA DE PÁGINA. NÃO TROQUE. ───────
       *
       * Eu troquei este `window.location.href` por `router.push` para evitar o
       * recarregamento do bundle, e isso QUEBROU a entrada na mesa por
       * completo. O motivo, medido:
       *
       *   goto / location.href  → "Sala de espera" abre
       *   router.push           → TOKEN_ALREADY_USED, a mesa nunca monta
       *
       * O `seatToken` é de USO ÚNICO: o `AetherRoom` guarda o `jti` de cada
       * passe consumido e recusa o segundo uso (FR-20). Com `router.push`, a
       * página da mesa monta DENTRO da árvore React existente, e o
       * `reactStrictMode: true` invoca o efeito de conexão duas vezes: a
       * primeira chamada resolve e queima o passe, a segunda é recusada pelo
       * servidor — corretamente.
       *
       * Numa carga completa de página as duas invocações acontecem antes de a
       * primeira promessa resolver, então só UMA chega ao servidor. É por isso
       * que o comportamento antigo funcionava e o "otimizado" não.
       *
       * A fragilidade de fundo é o efeito de conexão não ser idempotente com
       * um passe de uso único. Consertar isso é mexer no caminho de conexão da
       * mesa, e é uma mudança que precisa ser medida na mesa — não deduzida.
       * Até lá, a navegação completa é o que funciona.
       */
      window.location.href = destino;
    } catch (erro) {
      setErrorMsg(mensagemDaApi(erro));
      setIsConnecting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl animate-[fadeIn_0.3s_ease-out]">
      {/* Header do Saguão */}
      <header className="mb-8 sm:mb-10">
        {/* `break-words`: um nome de usuário longo estourava a largura da tela
            no celular e criava rolagem horizontal na página inteira. */}
        <h1 className="text-text mb-2 break-words text-2xl font-bold sm:text-3xl">
          Bem-vindo à Taverna, {user?.username}
        </h1>
        <p className="text-text-muted text-sm sm:text-base">
          A mesa está limpa. Suas cartas aguardam comandos.
        </p>
      </header>

      {/* Ações Principais (Entrar na Mesa) */}
      <section className="mb-10 grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:mb-12">
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

          {/* Empilha no celular: `tracking-widest` numa fonte monoespaçada
              come largura, e lado a lado com o botão o campo ficava com espaço
              para uns cinco caracteres — menos do que um código de sala. */}
          <div className="relative z-10 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="EX: DRG-402"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter conecta: o campo é de código, e digitar um código e
                // procurar o botão com o mouse é um passo a mais sem motivo.
                if (e.key === 'Enter' && roomCodeInput.trim()) handleOpenModal('JOIN');
              }}
              className="bg-table-deep border-panel-border text-text focus:border-success min-w-0 flex-1 rounded-md border px-4 py-2.5 font-mono uppercase tracking-widest focus:outline-none"
            />
            <button
              onClick={() => handleOpenModal('JOIN')}
              className="bg-success flex shrink-0 items-center justify-center gap-2 rounded-md px-5 py-2.5 font-medium text-white shadow-md transition-all hover:brightness-110 active:scale-95"
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
            {myDecks.length} {myDecks.length === 1 ? 'GRIMÓRIO' : 'GRIMÓRIOS'}
          </span>
        </div>

        {carregandoDecks ? (
          <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-panel border-panel-border h-24 animate-pulse rounded-xl border"
              />
            ))}
          </div>
        ) : myDecks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
            {myDecks.map((deck) => (
              // Vira link para o próprio grimório: o cartão mostrava nome e
              // contagem e não levava a lugar nenhum — quem quisesse abrir o
              // deck tinha de ir ao menu lateral e achá-lo de novo na lista.
              <Link
                key={deck.id}
                href={`/dashboard/decks/${deck.id}`}
                className="bg-panel border-panel-border hover:border-primary flex flex-col rounded-xl border p-4 text-left transition-colors"
              >
                <h3 className="text-text mb-1 w-full truncate text-lg font-bold">{deck.name}</h3>
                <span className="text-text-muted text-sm">
                  Cartas: {deck.cardCount ?? 0}
                  <span className="text-text-faint uppercase"> · {deck.formatId}</span>
                </span>
              </Link>
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
        <div
          className="fixed inset-0 z-50 flex animate-[fadeIn_0.2s_ease-out] items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            // Clicar fora fecha — mas nunca no meio de uma conexão, senão o
            // modal some enquanto a requisição continua e a tela não diz nada.
            if (e.target === e.currentTarget && !isConnecting) setIsModalOpen(false);
          }}
        >
          {/* `max-h`+rolagem: com o formato e a contagem de jogadores, o modal
              passa de 560px e não caberia numa tela de celular em paisagem. */}
          <div className="bg-panel border-panel-border custom-scrollbar max-h-[calc(100dvh-2rem)] w-full max-w-md animate-[popIn_0.2s_ease-out] overflow-y-auto rounded-xl border p-5 shadow-2xl sm:p-6">
            <h2 className="text-text mb-1 text-xl font-bold">
              {modalAction === 'CREATE' ? 'Forjar Nova Sala' : 'Entrar na Sala'}
            </h2>
            <p className="text-text-muted mb-6 text-sm">
              Você pode escolher o grimório agora ou já na sala de espera, depois de ver quem sentou
              à mesa. Decks com cartas banidas são bloqueados pelo juiz nos dois casos.
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
                <option value="">-- Escolher na sala de espera --</option>
                {myDecks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount ?? 0} cartas)
                  </option>
                ))}
              </select>
            </div>

            {modalAction === 'CREATE' && (
              <div className="mb-6 space-y-4">
                <div>
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Formato
                  </label>
                  <select
                    value={gameType}
                    onChange={(e) => {
                      const novo = e.target.value;
                      setGameType(novo);
                      // Reajusta a contagem para a faixa do formato novo:
                      // manter "6 jogadores" ao trocar para Duel Commander
                      // criaria uma mesa que o próprio formato não permite.
                      const preset = acharFormato(novo);
                      setMaxClients(preset.jogadores.padrao);
                    }}
                    className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                  >
                    {FORMATOS_JOGAVEIS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                        {f.status === 'BETA' ? ' (beta)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-text-faint mt-1.5 text-xs">{formato.resumo}</p>
                </div>

                <div>
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Jogadores
                  </label>
                  <select
                    value={maxClients}
                    onChange={(e) => setMaxClients(Number(e.target.value))}
                    disabled={formato.jogadores.min === formato.jogadores.max}
                    className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none disabled:opacity-60"
                  >
                    {/* A faixa vem do preset, não de uma lista fixa de 2 a 8.
                        O teto absoluto do sistema continua sendo
                        `REALTIME_LIMITS.MAX_PLAYERS`; o preset é mais estreito
                        onde o formato é mais estreito. */}
                    {Array.from(
                      { length: formato.jogadores.max - formato.jogadores.min + 1 },
                      (_, i) => formato.jogadores.min + i,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 jogador (solo)' : `${n} jogadores`}
                      </option>
                    ))}
                  </select>
                  {formato.jogadores.min === formato.jogadores.max && (
                    <p className="text-text-faint mt-1.5 text-xs">
                      {formato.nome} é jogado com exatamente {formato.jogadores.max}.
                    </p>
                  )}
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
                disabled={isConnecting}
                className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-6 py-2 font-medium text-white shadow-md transition-all active:scale-95 disabled:opacity-50"
              >
                {isConnecting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isConnecting ? 'Conectando...' : 'Entrar na Mesa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
