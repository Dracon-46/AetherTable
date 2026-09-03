'use client';

/**
 * Gestão de cosméticos (DOC-061 §3).
 *
 * ─── DOIS DOCUMENTOS SE CONTRADIZEM, E ESTA TELA ESCOLHE ───────────────────
 *
 * DOC-061 §3.1 pede um formulário com "URL da Imagem (upload via bucket
 * S3/Cloudflare R2)". DOC-060 §1.1 proíbe upload: o catálogo é FECHADO, por
 * dois riscos que moderação reativa não cobre — propriedade intelectual da
 * WotC e conteúdo sensível numa mesa que pode ter menores. E DOC-060 é a
 * decisão que o código implementa: os cosméticos são PROCEDURAIS, descritos por
 * cores e um nome de padrão, desenhados pelo cliente.
 *
 * Esta tela resolve a favor do mais restritivo. O que ela administra é a
 * DISPONIBILIDADE de itens que já existem no catálogo em código: tier mínimo,
 * ativo/inativo, e o registro que torna um item concedível como prêmio. Arte
 * nova entra por pull request em `shared-types/cosmetics.ts`, onde passa por
 * revisão — e o aviso na tela diz isso, para o administrador não procurar um
 * botão de upload que não vai existir.
 */

import { useState } from 'react';
import { AlertCircle, Ban, Check, Info, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  useAtualizarCosmetico,
  useCosmeticos,
  useRegistrarCosmetico,
  useRemoverCosmetico,
} from '../../../admin/useAdmin';
import { mensagemDaApi } from '@/lib/fetcher';

const ROTULO_DE_TIPO: Record<string, string> = {
  SLEEVE: 'Protetor',
  PLAYMAT: 'Tapete',
  BORDER: 'Borda de perfil',
  TITLE: 'Título no chat',
};

export default function CosmeticosPage() {
  const { data, isPending, isError, error } = useCosmeticos();
  const registrar = useRegistrarCosmetico();
  const atualizar = useAtualizarCosmetico();
  const remover = useRemoverCosmetico();

  const [escolhido, setEscolhido] = useState('');
  const [tier, setTier] = useState(0);

  if (isPending) {
    return (
      <div className="text-text-muted flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando catálogo…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-2 rounded-xl border p-4 text-sm">
        <AlertCircle className="h-5 w-5 shrink-0" />
        {mensagemDaApi(error)}
      </div>
    );
  }

  const jaRegistrados = new Set(data.registrados.map((r) => `${r.type}:${r.catalogoId}`));
  /** Só o que ainda NÃO está registrado, e só o que tem tipo no banco. */
  const disponiveis = data.catalogo.filter(
    (c) => c.tipo && !jaRegistrados.has(`${c.tipo}:${c.catalogoId}`),
  );
  const selecionado = disponiveis.find((c) => c.catalogoId === escolhido);

  return (
    <div className="space-y-6">
      <div className="border-primary/30 bg-primary/10 flex items-start gap-3 rounded-xl border p-4">
        <Info className="text-primary mt-0.5 h-5 w-5 shrink-0" />
        <div className="text-text min-w-0 text-sm">
          <p className="mb-1 font-semibold">Não há upload de imagem, e isso é intencional.</p>
          <p className="text-text-muted text-xs leading-relaxed">
            Os cosméticos são desenhados pelo cliente a partir de um catálogo fechado em código
            (DOC-060 §1.1) — cores e padrões, não arquivos. Isso evita risco de propriedade
            intelectual e conteúdo sensível, e faz o catálogo inteiro caber no bundle. Arte nova
            entra por pull request em <code className="text-text">shared-types/cosmetics.ts</code>.
            Aqui você controla <strong>quem pode usar</strong> o que já existe.
          </p>
        </div>
      </div>

      {/* ── Registrar ───────────────────────────────────────────────────── */}
      <section className="border-panel-border bg-panel rounded-xl border p-4">
        <h2 className="text-text mb-1 text-base font-bold">Tornar um item concedível</h2>
        <p className="text-text-muted mb-4 text-xs">
          Registrar um item do catálogo cria a linha que permite dá-lo a um jogador na aba Usuários.
          Sem registro, o item existe visualmente mas não pode ser premiado.
        </p>

        {disponiveis.length === 0 ? (
          <p className="text-text-muted text-sm">
            Todos os itens do catálogo já estão registrados.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
                Item do catálogo
              </label>
              <select
                value={escolhido}
                onChange={(e) => setEscolhido(e.target.value)}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">— escolha —</option>
                {disponiveis.map((c) => (
                  <option key={`${c.tipo}:${c.catalogoId}`} value={c.catalogoId}>
                    [{ROTULO_DE_TIPO[c.tipo!] ?? c.tipo}] {c.nome} ({c.tier})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:w-32">
              <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
                Tier mínimo
              </label>
              <input
                type="number"
                min={0}
                max={10}
                value={tier}
                onChange={(e) => setTier(Number(e.target.value))}
                className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <button
              onClick={() => {
                if (!selecionado?.tipo) return;
                registrar.mutate(
                  {
                    catalogoId: selecionado.catalogoId,
                    tipo: selecionado.tipo,
                    nome: selecionado.nome,
                    minTier: tier,
                  },
                  { onSuccess: () => setEscolhido('') },
                );
              }}
              disabled={!selecionado || registrar.isPending}
              className="bg-primary hover:bg-primary-hover flex shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {registrar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Registrar
            </button>
          </div>
        )}
        {registrar.isError && (
          <p className="text-danger mt-3 text-sm">{mensagemDaApi(registrar.error)}</p>
        )}
      </section>

      {/* ── Registrados ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 text-xs font-bold uppercase tracking-wider">
          Itens concedíveis ({data.registrados.length})
        </h2>

        {data.registrados.length === 0 ? (
          <p className="border-panel-border text-text-muted rounded-xl border border-dashed p-8 text-center text-sm">
            Nenhum item registrado ainda.
          </p>
        ) : (
          <div className="border-panel-border overflow-hidden rounded-xl border">
            <div className="custom-scrollbar overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-panel text-text-muted text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold">Item</th>
                    <th className="px-3 py-2 text-left font-bold">Tipo</th>
                    <th className="px-3 py-2 text-right font-bold">Tier</th>
                    <th className="px-3 py-2 text-right font-bold">Donos</th>
                    <th className="px-3 py-2 text-right font-bold">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.registrados.map((item) => (
                    <tr key={item.id} className="border-panel-border border-t">
                      <td className="px-3 py-2">
                        <div className="text-text font-medium">{item.name}</div>
                        <div className="text-text-faint font-mono text-[10px]">
                          {item.catalogoId}
                        </div>
                      </td>
                      <td className="text-text-muted px-3 py-2 text-xs">
                        {ROTULO_DE_TIPO[item.type] ?? item.type}
                      </td>
                      <td className="text-text px-3 py-2 text-right font-mono text-xs">
                        {item.minTier}
                      </td>
                      <td className="text-text-muted px-3 py-2 text-right font-mono text-xs">
                        {item.donos}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              atualizar.mutate({ id: item.id, corpo: { ativo: !item.isActive } })
                            }
                            title={
                              item.isActive
                                ? 'Desativar — sai do seletor dos jogadores, o inventário é preservado'
                                : 'Reativar'
                            }
                            className={`rounded p-1.5 transition-colors ${
                              item.isActive
                                ? 'text-success hover:bg-success/15'
                                : 'text-text-faint hover:bg-panel-hover'
                            }`}
                          >
                            {item.isActive ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => remover.mutate(item.id)}
                            // Desabilitado quando alguém possui: remover
                            // confiscaria o prêmio de todos eles. O servidor
                            // recusa de qualquer forma; aqui o botão explica
                            // antes do clique.
                            disabled={item.donos > 0 || remover.isPending}
                            title={
                              item.donos > 0
                                ? `${item.donos} jogador(es) possuem este item — desative em vez de remover`
                                : 'Desregistrar'
                            }
                            className="text-text-muted hover:bg-danger/15 hover:text-danger rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {(atualizar.isError || remover.isError) && (
          <p className="text-danger mt-3 text-sm">
            {mensagemDaApi(atualizar.error ?? remover.error)}
          </p>
        )}
      </section>

      {/* ── Catálogo completo ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 text-xs font-bold uppercase tracking-wider">
          Catálogo em código ({data.catalogo.length} itens)
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {data.catalogo.map((c) => (
            <div
              key={`${c.tipo ?? 'PET'}:${c.catalogoId}`}
              className="border-panel-border bg-panel rounded-lg border p-2.5"
            >
              <div className="text-text truncate text-sm font-medium">{c.nome}</div>
              <div className="text-text-faint flex items-center justify-between gap-2 text-[10px]">
                {/* Pets aparecem para o administrador VER o que existe, e não
                    são registráveis: o enum `CosmeticType` do banco não tem
                    valor para eles, e inventar um seria gravar um tipo que o
                    banco não conhece. */}
                <span className="uppercase">{c.tipo ? ROTULO_DE_TIPO[c.tipo] : 'mascote'}</span>
                <span
                  className={c.tier === 'APOIADOR' ? 'text-warning font-bold' : 'text-text-muted'}
                >
                  {c.tier}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
