'use client';

/**
 * Gestão de usuários (DOC-061 §2).
 *
 * ─── LISTA E FICHA NA MESMA TELA ───────────────────────────────────────────
 *
 * Um painel de moderação em duas rotas — lista, clica, navega, volta — perde o
 * contexto da busca a cada caso analisado. O moderador que investiga um padrão
 * de reincidência abre cinco contas em sequência; com navegação, ele redigita a
 * busca cinco vezes.
 *
 * ─── AS AÇÕES PASSAM TODAS PELO MESMO DIÁLOGO ──────────────────────────────
 *
 * `DialogoDeAcao` exige justificativa. Não há caminho por onde uma punição
 * aconteça sem o motivo ir para o log de auditoria — e é assim que a regra se
 * mantém: pedir o motivo é mais fácil do que contorná-lo.
 */

import { useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Gift,
  KeyRound,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserX,
  X,
} from 'lucide-react';
import {
  useAcaoDeUsuario,
  useCosmeticos,
  useUsuario,
  useUsuarios,
  type Papel,
  type UsuarioAdmin,
} from '../../../admin/useAdmin';
import {
  DialogoDeAcao,
  SeloDeEstado,
  SeloDePapel,
  quando,
  type CampoExtra,
} from '../../../admin/Componentes';
import { mensagemDaApi } from '@/lib/fetcher';
import { useSouAdmin } from '../../../admin/useAdmin';

type Acao =
  | 'suspender'
  | 'reativar'
  | 'banir'
  | 'restaurar'
  | 'papel'
  | 'conceder'
  | 'revogar'
  | 'senha'
  | 'excluir';

const TITULOS: Record<Acao, { titulo: string; descricao: string; botao: string; perigo: boolean }> =
  {
    suspender: {
      titulo: 'Suspender conta',
      descricao:
        'A pessoa não consegue entrar até o prazo vencer. A suspensão expira sozinha — não é preciso reativar.',
      botao: 'Suspender',
      perigo: false,
    },
    reativar: {
      titulo: 'Remover suspensão',
      descricao: 'A conta volta a poder entrar imediatamente.',
      botao: 'Reativar',
      perigo: false,
    },
    banir: {
      titulo: 'Banir conta',
      descricao:
        'A conta é inativada agora e entra no fluxo de expurgo de 30 dias (LGPD). Os decks e o histórico continuam existindo até o expurgo.',
      botao: 'Banir',
      perigo: true,
    },
    restaurar: {
      titulo: 'Restaurar conta',
      descricao: 'Desfaz o banimento e cancela o expurgo. A conta volta a funcionar.',
      botao: 'Restaurar',
      perigo: false,
    },
    papel: {
      titulo: 'Alterar papel',
      descricao:
        'MOD resolve denúncias e aplica punições. ADMIN faz tudo, inclusive promover outras contas e mexer nos interruptores da plataforma.',
      botao: 'Alterar',
      perigo: true,
    },
    conceder: {
      titulo: 'Conceder cosmético',
      descricao: 'O item entra no inventário da pessoa — é o prêmio de campeonato.',
      botao: 'Conceder',
      perigo: false,
    },
    senha: {
      titulo: 'Redefinir a senha',
      descricao:
        'O servidor GERA uma senha nova e mostra uma única vez — você a repassa à pessoa. Todas as sessões abertas dela caem na hora: se a conta foi invadida, o invasor é expulso junto. Você não vê nem escolhe a senha.',
      botao: 'Redefinir',
      perigo: true,
    },
    excluir: {
      titulo: 'Excluir definitivamente',
      descricao:
        'APAGA A CONTA E OS DECKS, e não tem volta — diferente de banir, que é reversível por "Restaurar". A trilha de auditoria e as estatísticas de partida sobrevivem, anonimizadas. Digite o nome de usuário exato para confirmar.',
      botao: 'Excluir para sempre',
      perigo: true,
    },
    revogar: {
      titulo: 'Retirar cosmético',
      descricao:
        'O item sai do inventário. Se estiver equipado, a preferência é limpa junto — senão a mesa desenharia um cosmético que a pessoa não possui mais.',
      botao: 'Retirar',
      perigo: true,
    },
  };

export default function UsuariosPage() {
  const { data: sessao } = useSouAdmin();
  const souAdmin = sessao?.papel === 'ADMIN';

  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [papel, setPapel] = useState<Papel | ''>('');
  const [apenasSuspensos, setApenasSuspensos] = useState(false);
  const [incluirApagados, setIncluirApagados] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  /** Senha recém-gerada, visível uma única vez. Ver o caso 'senha' em `confirmar`. */
  const [senhaGerada, setSenhaGerada] = useState<{ username: string; senha: string } | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);

  const { data, isPending, isError, error } = useUsuarios({
    q: termo,
    papel,
    apenasSuspensos,
    incluirApagados,
  });
  const ficha = useUsuario(selecionado);
  const cosmeticos = useCosmeticos();

  const suspender = useAcaoDeUsuario<{ dias: number; motivo: string }>(
    (id) => `/admin/usuarios/${id}/suspender`,
  );
  const reativar = useAcaoDeUsuario<{ motivo: string }>((id) => `/admin/usuarios/${id}/reativar`);
  const banir = useAcaoDeUsuario<{ motivo: string }>((id) => `/admin/usuarios/${id}/banir`);
  const restaurar = useAcaoDeUsuario<{ motivo: string }>((id) => `/admin/usuarios/${id}/restaurar`);
  const redefinirSenha = useAcaoDeUsuario<
    { motivo: string },
    { senhaTemporaria: string; username: string }
  >((id) => `/admin/usuarios/${id}/redefinir-senha`);
  const excluir = useAcaoDeUsuario<{ motivo: string; confirmacao: string }, { username: string }>(
    (id) => `/admin/usuarios/${id}`,
    'DELETE',
  );
  const mudarPapel = useAcaoDeUsuario<{ papel: string; motivo: string }>(
    (id) => `/admin/usuarios/${id}/papel`,
    'PATCH',
  );
  const conceder = useAcaoDeUsuario<{ cosmeticoId: string; motivo: string }>(
    (id) => `/admin/usuarios/${id}/inventario`,
  );
  const revogar = useAcaoDeUsuario<{ cosmeticoId: string; motivo: string }>(
    (id) => `/admin/usuarios/${id}/inventario`,
    'DELETE',
  );

  const mutacaoAtiva = {
    suspender,
    reativar,
    banir,
    restaurar,
    papel: mudarPapel,
    conceder,
    revogar,
    senha: redefinirSenha,
    excluir,
  }[acao ?? 'reativar'];

  const alvo = (ficha.data as unknown as UsuarioAdmin | undefined) ?? null;

  /** Campos extra do diálogo, por ação. */
  const extras: CampoExtra[] = (() => {
    if (acao === 'suspender') {
      return [
        {
          nome: 'dias',
          rotulo: 'Dias de suspensão',
          tipo: 'numero',
          valorInicial: '7',
          min: 1,
          max: 365,
          dica: 'Acima de 365 dias não é suspensão, é banimento — use o outro fluxo.',
        },
      ];
    }
    if (acao === 'papel') {
      return [
        {
          nome: 'papel',
          rotulo: 'Novo papel',
          tipo: 'selecao',
          valorInicial: alvo?.role === 'USER' ? 'MOD' : 'USER',
          opcoes: [
            { valor: 'USER', rotulo: 'USER — jogador comum' },
            { valor: 'MOD', rotulo: 'MOD — resolve denúncias e pune' },
            { valor: 'ADMIN', rotulo: 'ADMIN — acesso irrestrito' },
          ],
        },
      ];
    }
    if (acao === 'excluir') {
      return [
        {
          nome: 'confirmacao',
          rotulo: 'Digite o nome de usuário para confirmar',
          tipo: 'texto',
          valorInicial: '',
          dica: alvo
            ? `Exatamente: ${alvo.username}. O servidor recusa qualquer outra coisa — é a trava contra apagar a conta errada depois de clicar na linha errada da lista.`
            : undefined,
        },
      ];
    }
    if (acao === 'conceder' || acao === 'revogar') {
      const registrados = cosmeticos.data?.registrados ?? [];
      return [
        {
          nome: 'cosmeticoId',
          rotulo: 'Cosmético',
          tipo: 'selecao',
          valorInicial: registrados[0]?.id ?? '',
          opcoes: registrados.map((c) => ({ valor: c.id, rotulo: `${c.name} (${c.type})` })),
          dica: registrados.length
            ? undefined
            : 'Nenhum item registrado como concedível. Registre um na aba Cosméticos primeiro.',
        },
      ];
    }
    return [];
  })();

  function confirmar({
    motivo,
    extras: valores,
  }: {
    motivo: string;
    extras: Record<string, string>;
  }) {
    if (!selecionado || !acao) return;
    const feito = () => setAcao(null);
    switch (acao) {
      case 'suspender':
        suspender.mutate(
          { id: selecionado, corpo: { dias: Number(valores.dias ?? 7), motivo } },
          { onSuccess: feito },
        );
        break;
      case 'reativar':
        reativar.mutate({ id: selecionado, corpo: { motivo } }, { onSuccess: feito });
        break;
      case 'banir':
        banir.mutate({ id: selecionado, corpo: { motivo } }, { onSuccess: feito });
        break;
      case 'restaurar':
        restaurar.mutate({ id: selecionado, corpo: { motivo } }, { onSuccess: feito });
        break;
      case 'papel':
        mudarPapel.mutate(
          { id: selecionado, corpo: { papel: valores.papel ?? 'USER', motivo } },
          { onSuccess: feito },
        );
        break;
      case 'conceder':
        conceder.mutate(
          { id: selecionado, corpo: { cosmeticoId: valores.cosmeticoId ?? '', motivo } },
          { onSuccess: feito },
        );
        break;
      case 'revogar':
        revogar.mutate(
          { id: selecionado, corpo: { cosmeticoId: valores.cosmeticoId ?? '', motivo } },
          { onSuccess: feito },
        );
        break;
      /**
       * A senha gerada volta UMA VEZ e some: o servidor guarda só o hash
       * argon2id, então nem ele consegue reemitir a mesma. Por isso o sucesso
       * aqui não fecha a tela e pronto — ele abre o cartão de entrega, e quem
       * fechar sem copiar precisa redefinir de novo.
       */
      case 'senha':
        redefinirSenha.mutate(
          { id: selecionado, corpo: { motivo } },
          {
            onSuccess: (r) => {
              setSenhaGerada({ username: r.username, senha: r.senhaTemporaria });
              setAcao(null);
            },
          },
        );
        break;
      case 'excluir':
        excluir.mutate(
          { id: selecionado, corpo: { motivo, confirmacao: valores.confirmacao ?? '' } },
          {
            onSuccess: () => {
              // A conta deixou de existir: manter o painel aberto mostraria uma
              // ficha que o próximo refetch devolve como 404.
              setAcao(null);
              setSelecionado(null);
            },
          },
        );
        break;
    }
  }

  const botao =
    'border-panel-border bg-table-deep text-text hover:border-primary hover:text-primary flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* ── Lista ────────────────────────────────────────────────────────── */}
      <div className={selecionado ? 'lg:col-span-3' : 'lg:col-span-5'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTermo(busca.trim());
          }}
          className="mb-4 flex flex-col gap-2 sm:flex-row"
        >
          <div className="relative min-w-0 flex-1">
            <Search className="text-text-muted pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="username, e-mail ou id…"
              className="border-panel-border bg-panel text-text focus:border-primary w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none"
            />
          </div>
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value as Papel | '')}
            className="bg-panel border-panel-border text-text focus:border-primary rounded-md border px-3 py-2 text-sm focus:outline-none"
            aria-label="Filtrar por papel"
          >
            <option value="">Todos os papéis</option>
            <option value="USER">USER</option>
            <option value="MOD">MOD</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button
            type="submit"
            className="bg-primary hover:bg-primary-hover shrink-0 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Buscar
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-4 text-xs">
          <label className="text-text-muted flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={apenasSuspensos}
              onChange={(e) => setApenasSuspensos(e.target.checked)}
              className="accent-primary"
            />
            Só suspensos
          </label>
          <label className="text-text-muted flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={incluirApagados}
              onChange={(e) => setIncluirApagados(e.target.checked)}
              className="accent-primary"
            />
            Incluir banidos
          </label>
        </div>

        {isPending ? (
          <div className="text-text-muted flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
          </div>
        ) : isError ? (
          <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-lg border p-3 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {mensagemDaApi(error)}
          </div>
        ) : (
          <div className="border-panel-border overflow-hidden rounded-xl border">
            {/* `overflow-x-auto` no wrapper e não na tabela: e-mail + username +
                selos passam de 600px, e sem isto a página inteira rolava para o
                lado no celular. */}
            <div className="custom-scrollbar overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-panel text-text-muted text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Conta</th>
                    <th className="px-3 py-2 text-left font-bold">Estado</th>
                    <th className="px-3 py-2 text-right font-bold">Decks</th>
                    <th className="px-3 py-2 text-right font-bold">Denúncias</th>
                    <th className="px-3 py-2 text-left font-bold">Entrou</th>
                  </tr>
                </thead>
                <tbody>
                  {data.itens.map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => setSelecionado(u.id)}
                      className={`border-panel-border hover:bg-panel-hover cursor-pointer border-t transition-colors ${
                        selecionado === u.id ? 'bg-primary/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="text-text flex items-center gap-2 font-medium">
                          <span className="truncate">{u.username}</span>
                          <SeloDePapel papel={u.role} />
                        </div>
                        <div className="text-text-faint truncate text-xs">{u.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <SeloDeEstado suspendedUntil={u.suspendedUntil} deletedAt={u.deletedAt} />
                      </td>
                      <td className="text-text-muted px-3 py-2 text-right font-mono text-xs">
                        {u._count?.decks ?? 0}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono text-xs ${
                          (u._count?.reportsGot ?? 0) > 0
                            ? 'text-warning font-bold'
                            : 'text-text-muted'
                        }`}
                      >
                        {u._count?.reportsGot ?? 0}
                      </td>
                      <td className="text-text-faint px-3 py-2 text-xs">{quando(u.createdAt)}</td>
                    </tr>
                  ))}
                  {data.itens.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-text-muted px-3 py-8 text-center text-sm">
                        Nenhuma conta casa com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Ficha ────────────────────────────────────────────────────────── */}
      {selecionado && (
        <aside className="lg:col-span-2">
          <div className="border-panel-border bg-panel sticky top-32 rounded-xl border p-4">
            {ficha.isPending ? (
              <div className="text-text-muted flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando ficha…
              </div>
            ) : !alvo ? (
              <p className="text-text-muted text-sm">Conta não encontrada.</p>
            ) : (
              <>
                <div className="mb-4 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-text flex items-center gap-2 text-base font-bold">
                      <span className="truncate">{alvo.username}</span>
                      <SeloDePapel papel={alvo.role} />
                    </h2>
                    <p className="text-text-faint truncate text-xs">{alvo.email}</p>
                  </div>
                  <button
                    onClick={() => setSelecionado(null)}
                    className="text-text-muted hover:text-text shrink-0"
                    aria-label="Fechar ficha"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <dl className="border-panel-border mb-4 space-y-1.5 border-y py-3 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Estado</dt>
                    <dd>
                      <SeloDeEstado
                        suspendedUntil={alvo.suspendedUntil}
                        deletedAt={alvo.deletedAt}
                      />
                    </dd>
                  </div>
                  {alvo.suspensionReason && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-text-muted shrink-0">Motivo</dt>
                      <dd className="text-warning min-w-0 text-right">{alvo.suspensionReason}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Visto por último</dt>
                    <dd className="text-text">{quando(alvo.lastSeenAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">Conta criada</dt>
                    <dd className="text-text">{quando(alvo.createdAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted">E-mail verificado</dt>
                    <dd className="text-text">{alvo.emailVerifiedAt ? 'sim' : 'não'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-muted shrink-0">Id</dt>
                    <dd className="text-text-faint min-w-0 truncate font-mono text-[10px]">
                      {alvo.id}
                    </dd>
                  </div>
                </dl>

                <div className="mb-4 flex flex-wrap gap-2">
                  {alvo.deletedAt ? (
                    souAdmin && (
                      <button onClick={() => setAcao('restaurar')} className={botao}>
                        <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                      </button>
                    )
                  ) : (
                    <>
                      {alvo.suspendedUntil &&
                      new Date(alvo.suspendedUntil).getTime() > Date.now() ? (
                        <button onClick={() => setAcao('reativar')} className={botao}>
                          <RotateCcw className="h-3.5 w-3.5" /> Remover suspensão
                        </button>
                      ) : (
                        <button onClick={() => setAcao('suspender')} className={botao}>
                          <UserMinus className="h-3.5 w-3.5" /> Suspender
                        </button>
                      )}
                      <button
                        onClick={() => setAcao('banir')}
                        className={`${botao} hover:border-danger hover:text-danger`}
                      >
                        <UserX className="h-3.5 w-3.5" /> Banir
                      </button>
                    </>
                  )}

                  {/* Promover e mexer no inventário são de ADMIN (DOC-061 §2).
                      Sem esconder, o moderador clicaria e levaria um 403 — a
                      regra existe no servidor de qualquer forma. */}
                  {souAdmin && (
                    <>
                      <button onClick={() => setAcao('papel')} className={botao}>
                        <ShieldCheck className="h-3.5 w-3.5" /> Alterar papel
                      </button>
                      <button onClick={() => setAcao('conceder')} className={botao}>
                        <Gift className="h-3.5 w-3.5" /> Conceder item
                      </button>
                      <button onClick={() => setAcao('senha')} className={botao}>
                        <KeyRound className="h-3.5 w-3.5" /> Redefinir senha
                      </button>
                      <button
                        onClick={() => setAcao('excluir')}
                        className={`${botao} hover:border-danger hover:text-danger`}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </>
                  )}
                </div>

                <FichaExtra dados={ficha.data as Record<string, unknown>} />
              </>
            )}
          </div>
        </aside>
      )}

      {acao && (
        <DialogoDeAcao
          aberto
          titulo={TITULOS[acao].titulo}
          descricao={`${TITULOS[acao].descricao}${alvo ? ` Conta: ${alvo.username}.` : ''}`}
          rotuloConfirmar={TITULOS[acao].botao}
          perigo={TITULOS[acao].perigo}
          extras={extras}
          ocupado={mutacaoAtiva.isPending}
          erro={mutacaoAtiva.error}
          onConfirmar={confirmar}
          onCancelar={() => setAcao(null)}
        />
      )}

      {senhaGerada && <SenhaTemporaria dados={senhaGerada} onFechar={() => setSenhaGerada(null)} />}
    </div>
  );
}

/**
 * A senha gerada, mostrada uma vez.
 *
 * ─── POR QUE NÃO HÁ "VER DE NOVO" ──────────────────────────────────────────
 *
 * O servidor gera, hasheia com argon2id e devolve o texto na mesma resposta —
 * depois disso só existe o hash. Nem o banco, nem o log de auditoria, nem esta
 * tela guardam a senha em lugar nenhum, o que é a razão de o admin nunca ficar
 * sabendo a senha ANTIGA de ninguém: ele não recupera, ele substitui.
 *
 * O preço é este cartão ser a única chance. Fechar sem copiar significa
 * redefinir de novo — barato, e muito mais barato do que uma senha temporária
 * guardada em algum lugar "para o caso de".
 *
 * ─── O AVISO DE SESSÕES ────────────────────────────────────────────────────
 *
 * Redefinir derruba TODA sessão aberta da conta (o corte por `tokensValidosApos`
 * em `jwt.strategy.ts`). Isso é o efeito desejado quando a conta foi invadida, e
 * é uma surpresa quando o admin só queria ajudar alguém que esqueceu a senha —
 * por isso está escrito aqui, e não só no diálogo de antes.
 */
function SenhaTemporaria({
  dados,
  onFechar,
}: {
  dados: { username: string; senha: string };
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="border-panel-border bg-panel w-full max-w-md rounded-xl border p-5 shadow-2xl">
        <div className="mb-3 flex items-start gap-2">
          <KeyRound className="text-primary mt-0.5 h-5 w-5 shrink-0" />
          <h2 className="text-text flex-1 text-base font-bold">
            Senha temporária de {dados.username}
          </h2>
        </div>

        <p className="text-text-muted mb-4 text-sm">
          Copie agora e entregue pelo canal combinado. Ela não pode ser vista de novo — se fechar
          sem copiar, refaça a redefinição.
        </p>

        <div className="bg-table-deep border-panel-border mb-3 flex items-center gap-2 rounded-md border p-3">
          <code className="text-text min-w-0 flex-1 select-all break-all font-mono text-sm">
            {dados.senha}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(dados.senha)
                .then(() => setCopiado(true))
                // Sem permissão de área de transferência o texto continua
                // selecionável: o `select-all` acima é o caminho manual.
                .catch(() => undefined);
            }}
            className="border-panel-border text-text-muted hover:border-primary hover:text-primary shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors"
          >
            {copiado ? (
              <span className="text-success flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Copiado
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Copy className="h-3.5 w-3.5" /> Copiar
              </span>
            )}
          </button>
        </div>

        <p className="border-warning/30 bg-warning/10 text-warning mb-4 rounded-md border p-3 text-xs">
          Todas as sessões abertas desta conta caíram agora. A pessoa precisa entrar de novo com
          esta senha — e trocá-la nos Ajustes em seguida.
        </p>

        <button
          onClick={onFechar}
          className="bg-primary text-table-deep w-full rounded-md px-4 py-2 text-sm font-bold transition-opacity hover:opacity-90"
        >
          Já copiei, pode fechar
        </button>
      </div>
    </div>
  );
}

/**
 * Decks, denúncias e histórico de punições da conta.
 *
 * O HISTÓRICO é a parte que importa: ele responde "isto é reincidência?", a
 * pergunta que decide entre um aviso e um banimento. Sem ele, cada moderador
 * julga cada caso como se fosse o primeiro.
 */
function FichaExtra({ dados }: { dados: Record<string, unknown> }) {
  const contagens = dados._count as Record<string, number> | undefined;
  const decks = (dados.decks ?? []) as Array<{ id: string; name: string; cardCount: number }>;
  const denuncias = (dados.denuncias ?? []) as Array<{
    id: string;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  const historico = (dados.historico ?? []) as Array<{
    id: string;
    action: string;
    actorLabel: string;
    reason: string | null;
    createdAt: string;
  }>;

  return (
    <div className="space-y-4 text-xs">
      <div className="text-text-muted grid grid-cols-3 gap-2">
        <span>
          <strong className="text-text block font-mono text-base">{contagens?.decks ?? 0}</strong>
          decks
        </span>
        <span>
          <strong className="text-text block font-mono text-base">
            {contagens?.participions ?? 0}
          </strong>
          partidas
        </span>
        <span>
          <strong
            className={`block font-mono text-base ${
              (contagens?.reportsGot ?? 0) > 0 ? 'text-warning' : 'text-text'
            }`}
          >
            {contagens?.reportsGot ?? 0}
          </strong>
          denúncias
        </span>
      </div>

      {historico.length > 0 && (
        <section>
          <h3 className="text-text-muted mb-1.5 text-[11px] font-bold uppercase">
            Histórico de ações
          </h3>
          <ul className="custom-scrollbar max-h-40 space-y-1 overflow-y-auto">
            {historico.map((h) => (
              <li key={h.id} className="bg-table-deep rounded p-2">
                <div className="text-text flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] font-bold">{h.action}</span>
                  <span className="text-text-faint shrink-0 text-[10px]">
                    {quando(h.createdAt)}
                  </span>
                </div>
                <div className="text-text-faint">
                  por {h.actorLabel}
                  {h.reason ? ` — ${h.reason}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {denuncias.length > 0 && (
        <section>
          <h3 className="text-text-muted mb-1.5 text-[11px] font-bold uppercase">
            Denúncias recebidas
          </h3>
          <ul className="space-y-1">
            {denuncias.slice(0, 8).map((d) => (
              <li key={d.id} className="bg-table-deep flex justify-between gap-2 rounded p-2">
                <span className="text-text">{d.reason}</span>
                <span className="text-text-faint shrink-0">{d.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decks.length > 0 && (
        <section>
          <h3 className="text-text-muted mb-1.5 text-[11px] font-bold uppercase">Grimórios</h3>
          <ul className="custom-scrollbar max-h-32 space-y-1 overflow-y-auto">
            {decks.map((d) => (
              <li key={d.id} className="text-text-muted flex justify-between gap-2">
                <span className="truncate">{d.name}</span>
                <span className="shrink-0 font-mono">{d.cardCount}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
