'use client';

import { useMemo, useState } from 'react';
import {
  Play,
  KeyRound,
  Library,
  Plus,
  Loader2,
  Eye,
  Globe,
  Lock,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '../../store/auth.store';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useListaDeDecks } from '../../deckbuilder/useDecks';
import {
  FORMATOS_JOGAVEIS,
  IDIOMAS_DE_MESA,
  LIMITES_DE_SALA,
  MODOS_DE_COMUNICACAO,
  NIVEIS_DE_PODER,
  NOME_DA_COMUNICACAO,
  NOME_DO_IDIOMA,
  acharFormato,
  ehNomeDeSala,
  formatoTemNivelDePoder,
  nomeDeSalaSugerido,
  nomeDoNivelDePoder,
  normalizarConfigDeSala,
  type ConfigDeSala,
} from '@aethertable/shared-types';
import {
  FILTROS_VAZIOS,
  acaoDaSala,
  filtrarSalas,
  useSalasPublicas,
  type FiltrosDeSala,
} from '@/net/useSalasPublicas';

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
   * ─── O RESTO DA CONFIGURAÇÃO DA SALA ───────────────────────────────────────
   *
   * Cinco campos que antes não existiam em lugar nenhum: a mesa nascia sem
   * nome, sempre privada por omissão (nunca por escolha) e sem nada que dissesse
   * a estranhos o que ela era.
   *
   * Nenhum deles é validado aqui à mão: `normalizarConfigDeSala` — a MESMA
   * função que a API e o game-server chamam — decide o que vale. Uma terceira
   * cópia da regra divergiria na primeira mudança de catálogo, e a divergência
   * apareceria como "o formulário aceitou e a mesa abriu diferente".
   */
  const [nome, setNome] = useState('');
  const [visibilidade, setVisibilidade] = useState<ConfigDeSala['visibilidade']>('PRIVADA');
  const [comunicacao, setComunicacao] = useState<ConfigDeSala['comunicacao']>('QUALQUER');
  const [idioma, setIdioma] = useState<ConfigDeSala['idioma']>('pt-BR');
  /** `null` = o anfitrião não declarou. Nunca é calculado a partir do deck. */
  const [nivelDePoder, setNivelDePoder] = useState<number | null>(null);

  // Nível de poder só existe onde há zona de comando: os brackets são uma
  // escala de Commander, e "nível 4" em Modern não tem referência nenhuma.
  const temNivelDePoder = formatoTemNivelDePoder(gameType);

  /** O nome que vai de fato para a API — vazio vira a sugestão do username. */
  const nomeEfetivo = nome.trim() || nomeDeSalaSugerido(user?.username);
  const nomeValido = ehNomeDeSala(nomeEfetivo);

  // ─── Vitrine de salas públicas ─────────────────────────────────────────────
  const {
    data: salas,
    isPending: carregandoSalas,
    isError: erroSalas,
    refetch,
  } = useSalasPublicas();
  const [filtros, setFiltros] = useState<FiltrosDeSala>(FILTROS_VAZIOS);
  const salasVisiveis = useMemo(() => filtrarSalas(salas ?? [], filtros), [salas, filtros]);
  /** Só os formatos que de fato têm mesa aberta — um filtro com 30 opções vazias não filtra nada. */
  const formatosNaVitrine = useMemo(
    () => Array.from(new Set((salas ?? []).map((s) => s.gameType))).sort(),
    [salas],
  );
  const [entrandoEm, setEntrandoEm] = useState('');

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
      /**
       * Passe de CONFIGURAÇÃO: a config assinada pela API, que o `join` devolve
       * embutida no seat token.
       *
       * Sem ele, as opções da sala chegariam ao `onCreate` só pela querystring
       * — escritas pelo navegador, sem assinatura — e nada impediria alguém de
       * editar um número e abrir uma mesa de Duel Commander com oito assentos.
       */
      let configToken: string | undefined;

      // Se for CREATE, chamamos a rota create primeiro
      if (modalAction === 'CREATE') {
        // Normalizado ANTES de enviar, com a mesma função que a API vai usar:
        // o formulário nunca manda uma combinação que o servidor recusaria.
        const config = normalizarConfigDeSala({
          nome: nomeEfetivo,
          gameType,
          visibilidade,
          comunicacao,
          idioma,
          maxClients,
          nivelDePoder,
        });

        const criada = await api<{ roomCode: string; configToken?: string }>('/matches/create', {
          method: 'POST',
          body: config,
        });
        code = criada.roomCode;
        configToken = criada.configToken;
      }

      // Em ambos os casos, o JOIN valida o deck e devolve o seatToken.
      // Sem deck: o passe sai sem `deckId` e o jogador escolhe no lobby.
      const passe = await api<{ seatToken: string }>(`/matches/${code}/join`, {
        method: 'POST',
        body: {
          ...(selectedDeckId ? { deckId: selectedDeckId } : {}),
          ...(configToken ? { configToken } : {}),
        },
      });

      let destino = `/play/${code}?token=${passe.seatToken}`;
      if (modalAction === 'CREATE') {
        // A querystring continua levando o essencial porque o `onCreate` roda
        // ANTES do `onAuth` e precisa de algo para abrir a sala. O que ela leva
        // é só um ponto de partida: a config assinada chega logo em seguida, no
        // `onAuth` do criador, e sobrescreve o que veio por aqui.
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

  /**
   * Entrar direto por um cartão da vitrine, sem passar pelo modal.
   *
   * Quem clica numa mesa da lista já escolheu a mesa — pedir o código que ele
   * acabou de ver na tela seria cobrar um passo que a lista existe para
   * eliminar. O grimório fica para a sala de espera, que é onde ele consegue
   * ver quem sentou antes de decidir.
   */
  const entrarNaSala = async (roomCode: string) => {
    setEntrandoEm(roomCode);
    setErrorMsg('');
    try {
      const passe = await api<{ seatToken: string }>(`/matches/${roomCode}/join`, {
        method: 'POST',
        body: {},
      });
      // Carga completa de página, pelo mesmo motivo do `handleConnect`.
      window.location.href = `/play/${roomCode}?token=${passe.seatToken}`;
    } catch (erro) {
      setErrorMsg(mensagemDaApi(erro));
      setEntrandoEm('');
    }
  };

  /**
   * Assistir uma mesa cheia ou em andamento.
   *
   * O passe de espectador vem de uma ROTA PRÓPRIA, e não de uma flag no join:
   * a diferença entre assistir e jogar decide quem ocupa o último assento, e
   * essa decisão não pode ser um booleano que o navegador manda. Com rotas
   * separadas, quem autoriza é a claim assinada.
   *
   * `?espectador=1` na URL é só para a mesa saber o que desenhar antes de o
   * primeiro patch chegar — quem manda é o token.
   */
  const assistirSala = async (roomCode: string) => {
    setEntrandoEm(roomCode);
    setErrorMsg('');
    try {
      const passe = await api<{ seatToken: string }>(`/matches/${roomCode}/spectate`, {
        method: 'POST',
        body: {},
      });
      window.location.href = `/play/${roomCode}?token=${passe.seatToken}&espectador=1`;
    } catch (erro) {
      setErrorMsg(mensagemDaApi(erro));
      setEntrandoEm('');
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
          {/* O placeholder era `EX: DRG-402`, um formato que o sistema NUNCA
              gera: o `roomCode` sai de `randomBytes(3).toString('hex')` — seis
              hexadecimais, sem hífen e sem letra depois do F. Quem digitava
              seguindo o exemplo recebia "Código de sala inválido" do zod, sem
              nada que explicasse o que estava errado. O `maxLength` corta o
              erro antes: o campo não aceita mais do que um código cabe. */}
          <div className="relative z-10 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="EX: 7C60D5"
              maxLength={6}
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

      {/* ─── Vitrine de mesas públicas ───────────────────────────────────── */}
      <section className="mb-10 lg:mb-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Globe className="text-text h-6 w-6" />
            <h2 className="text-text text-xl font-bold">Mesas abertas</h2>
            <span className="text-text-muted bg-panel border-panel-border rounded-full border px-3 py-1 text-xs font-semibold">
              {salasVisiveis.length}
            </span>
          </div>
          <button
            onClick={() => void refetch()}
            className="text-text-muted hover:text-text border-panel-border bg-panel flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${carregandoSalas ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {/* Busca e filtros */}
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="text-text-faint pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={filtros.busca}
              onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
              placeholder="Buscar pelo nome da mesa"
              className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
          <select
            value={filtros.gameType}
            onChange={(e) => setFiltros((f) => ({ ...f, gameType: e.target.value }))}
            className="bg-table-deep border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Todos os formatos</option>
            {/* Só os formatos com mesa aberta: um filtro com 30 opções vazias
                não filtra nada, só dá trabalho de ler. */}
            {formatosNaVitrine.map((id) => (
              <option key={id} value={id}>
                {acharFormato(id).nome}
              </option>
            ))}
          </select>
          <select
            value={filtros.comunicacao}
            onChange={(e) => setFiltros((f) => ({ ...f, comunicacao: e.target.value }))}
            className="bg-table-deep border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Qualquer comunicação</option>
            {MODOS_DE_COMUNICACAO.map((m) => (
              <option key={m} value={m}>
                {NOME_DA_COMUNICACAO[m]}
              </option>
            ))}
          </select>
          <select
            value={filtros.idioma}
            onChange={(e) => setFiltros((f) => ({ ...f, idioma: e.target.value }))}
            className="bg-table-deep border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">Qualquer idioma</option>
            {IDIOMAS_DE_MESA.map((i) => (
              <option key={i} value={i}>
                {NOME_DO_IDIOMA[i]}
              </option>
            ))}
          </select>
        </div>

        {erroSalas ? (
          // A vitrine é o único pedaço da Taverna que depende do game-server.
          // Ele pode estar em manutenção com a API Core de pé — e nesse caso
          // criar mesa e entrar por código continuam funcionando.
          <div className="bg-panel/50 border-panel-border rounded-xl border border-dashed p-6 text-center">
            <p className="text-text-muted text-sm">
              A lista de mesas está indisponível agora. Criar uma mesa e entrar por código continuam
              funcionando.
            </p>
          </div>
        ) : carregandoSalas ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-panel border-panel-border h-28 animate-pulse rounded-xl border"
              />
            ))}
          </div>
        ) : salasVisiveis.length === 0 ? (
          <div className="bg-panel/50 border-panel-border flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
            <Globe className="text-text-muted mb-3 h-8 w-8" />
            <h3 className="text-text mb-1 font-medium">
              {(salas?.length ?? 0) > 0 ? 'Nenhuma mesa com esses filtros' : 'Nenhuma mesa aberta'}
            </h3>
            <p className="text-text-muted max-w-md text-sm">
              {(salas?.length ?? 0) > 0
                ? 'Afrouxe os filtros para ver as outras mesas.'
                : 'Crie a sua e marque como pública para ela aparecer aqui.'}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {salasVisiveis.map((sala) => {
              const acao = acaoDaSala(sala);
              const ocupada = `${sala.ocupacao}/${sala.maxSeats}`;
              const nivel = nomeDoNivelDePoder(sala.nivelDePoder);
              const trabalhando = entrandoEm === sala.roomCode;

              return (
                <li
                  key={sala.roomCode}
                  className="bg-panel border-panel-border hover:border-primary flex flex-col gap-3 rounded-xl border p-4 transition-colors"
                >
                  <div className="min-w-0">
                    <h3 className="text-text truncate font-bold">{sala.nome}</h3>
                    <p className="text-text-muted mt-0.5 truncate text-xs">
                      {acharFormato(sala.gameType).nome}
                      {sala.emPartida ? ' · em partida' : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="border-panel-border bg-table-deep text-text-muted flex items-center gap-1 rounded-full border px-2 py-0.5">
                      <Users className="h-3 w-3" />
                      {ocupada}
                    </span>
                    <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-2 py-0.5">
                      {NOME_DO_IDIOMA[sala.idioma] ?? sala.idioma}
                    </span>
                    <span className="border-panel-border bg-table-deep text-text-muted rounded-full border px-2 py-0.5">
                      {NOME_DA_COMUNICACAO[sala.comunicacao] ?? sala.comunicacao}
                    </span>
                    {/* "Declarado" fica escrito: não existe calculador de
                        bracket, e um rótulo que parecesse validação viraria
                        discussão na mesa sobre garantia que ninguém deu. */}
                    {nivel && (
                      <span
                        className="border-primary/40 bg-primary/10 text-primary rounded-full border px-2 py-0.5"
                        title="Nível declarado pelo anfitrião — o sistema não valida decks contra ele."
                      >
                        Nível {nivel} (declarado)
                      </span>
                    )}
                  </div>

                  {acao === 'ENTRAR' ? (
                    <button
                      onClick={() => void entrarNaSala(sala.roomCode)}
                      disabled={trabalhando}
                      className="bg-primary hover:bg-primary-hover flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-all active:scale-95 disabled:opacity-50"
                    >
                      {trabalhando ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Entrar
                    </button>
                  ) : (
                    <button
                      onClick={() => void assistirSala(sala.roomCode)}
                      disabled={trabalhando}
                      title="Assistir sem ocupar assento. Você vê a mesa e o chat, e não vê mão nem grimório de ninguém."
                      className="border-panel-border bg-table-deep text-text hover:border-primary flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {trabalhando ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      Assistir
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
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
                aria-label="Selecione seu Deck"
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
                    Nome da mesa
                  </label>
                  <input
                    type="text"
                    value={nome}
                    onChange={(e) => setNome(e.target.value.slice(0, LIMITES_DE_SALA.NOME_MAX))}
                    placeholder={nomeDeSalaSugerido(user?.username)}
                    className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                  />
                  <div className="mt-1.5 flex items-start justify-between gap-2">
                    {/* Deixar em branco não é erro: vira a sugestão do
                        username. Quem só quer entrar e jogar não deveria ter
                        de inventar um nome antes. */}
                    <p className="text-text-faint text-xs">
                      {nome.trim()
                        ? nomeValido
                          ? 'Aparece na lista de mesas se ela for pública.'
                          : `Precisa de ${LIMITES_DE_SALA.NOME_MIN} a ${LIMITES_DE_SALA.NOME_MAX} caracteres visíveis.`
                        : `Em branco vira “${nomeDeSalaSugerido(user?.username)}”.`}
                    </p>
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        nome.trim() && !nomeValido ? 'text-danger' : 'text-text-faint'
                      }`}
                    >
                      {nome.trim().length}/{LIMITES_DE_SALA.NOME_MAX}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Visibilidade
                  </label>
                  {/* A única opção desta tela com consequência para estranhos,
                      então o que cada uma significa fica ESCRITO — não só o
                      rótulo. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(
                      [
                        {
                          valor: 'PRIVADA' as const,
                          Icone: Lock,
                          titulo: 'Privada',
                          texto: 'Só quem tem o código entra.',
                        },
                        {
                          valor: 'PUBLICA' as const,
                          Icone: Globe,
                          titulo: 'Pública',
                          texto: 'Aparece na lista de mesas abertas.',
                        },
                      ] as const
                    ).map(({ valor, Icone, titulo, texto }) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setVisibilidade(valor)}
                        className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                          visibilidade === valor
                            ? 'border-primary bg-primary/10'
                            : 'border-panel-border bg-table-deep hover:border-panel-border'
                        }`}
                      >
                        <span className="text-text flex items-center gap-2 text-sm font-bold">
                          <Icone className="h-4 w-4" />
                          {titulo}
                        </span>
                        <span className="text-text-faint text-xs">{texto}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                    Formato
                  </label>
                  <select
                    value={gameType}
                    aria-label="Formato"
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
                    aria-label="Jogadores"
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                      Comunicação
                    </label>
                    <select
                      value={comunicacao}
                      aria-label="Comunicação"
                      onChange={(e) =>
                        setComunicacao(e.target.value as ConfigDeSala['comunicacao'])
                      }
                      className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                    >
                      {MODOS_DE_COMUNICACAO.map((m) => (
                        <option key={m} value={m}>
                          {NOME_DA_COMUNICACAO[m]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                      Idioma da mesa
                    </label>
                    <select
                      value={idioma}
                      aria-label="Idioma da mesa"
                      onChange={(e) => setIdioma(e.target.value as ConfigDeSala['idioma'])}
                      className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                    >
                      {IDIOMAS_DE_MESA.map((i) => (
                        <option key={i} value={i}>
                          {NOME_DO_IDIOMA[i]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Os dois campos acima FILTRAM a lista e dizem a intenção da
                    mesa. O sistema não impõe nenhum dos dois: a voz continua
                    sendo pelo LiveKit e disponível de qualquer forma. Dizer
                    isso aqui evita a leitura de que marcar "só texto" desliga
                    o microfone de alguém. */}
                <p className="text-text-faint -mt-2 text-xs">
                  Comunicação e idioma são sinalização social: eles filtram a lista e dizem a
                  intenção da mesa. O sistema não impõe nenhum dos dois.
                </p>

                {/* Nível de poder só onde há zona de comando — os brackets são
                    uma escala de Commander. */}
                {temNivelDePoder && (
                  <div>
                    <label className="text-text-muted mb-2 block text-xs font-bold uppercase">
                      Nível de poder declarado
                    </label>
                    <select
                      value={nivelDePoder ?? ''}
                      aria-label="Nível de poder declarado"
                      onChange={(e) =>
                        setNivelDePoder(e.target.value ? Number(e.target.value) : null)
                      }
                      className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 focus:outline-none"
                    >
                      <option value="">— não declarar —</option>
                      {NIVEIS_DE_PODER.map((n) => (
                        <option key={n.valor} value={n.valor}>
                          {n.valor} · {n.nome}
                        </option>
                      ))}
                    </select>
                    <p className="text-text-faint mt-1.5 text-xs">
                      {/* A palavra "declarado" no rótulo e a frase abaixo não
                          são redundância: não existe calculador de bracket
                          aqui, e um seletor que parecesse validar deck viraria
                          discussão na mesa sobre uma garantia que o sistema
                          nunca deu. */}
                      {NIVEIS_DE_PODER.find((n) => n.valor === nivelDePoder)?.resumo ??
                        'Uma etiqueta escolhida por você. O sistema não analisa nem valida os decks da mesa contra ela.'}
                    </p>
                  </div>
                )}
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
