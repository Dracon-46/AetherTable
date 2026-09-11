'use client';

/**
 * CriarCosmetico.tsx — compor um cosmético novo sem passar por deploy.
 *
 * ─── O QUE MUDOU, E O QUE CONTINUA VALENDO ─────────────────────────────────
 *
 * Até aqui, um cosmético só nascia por pull request em
 * `shared-types/cosmetics.ts`. Isso deixava "que itens o jogo tem" na mão de
 * quem tem acesso ao repositório, e não de quem administra o produto.
 *
 * DOC-060 §1.1 continua valendo inteiro. Não há upload aqui, não entra arquivo
 * de imagem, não entra arte de terceiros: o que este formulário compõe são
 * COMBINAÇÕES de primitivas que o cliente já sabe desenhar — as tramas, as
 * silhuetas, e cores. O vocabulário vem de `VOCABULARIO_DE_COSMETICOS`, que é
 * a mesma união de literais que o renderizador conhece, e o servidor recusa o
 * que estiver fora dela.
 *
 * ─── A PRÉVIA USA O RENDERIZADOR DE VERDADE ────────────────────────────────
 *
 * `sleeveCanvasDe` e `playmatCanvasDe` são as MESMAS funções que desenham a
 * mesa, recebendo o item em edição em vez de um id. Desenhar uma aproximação
 * aqui seria uma segunda implementação livre para divergir — e a divergência
 * só apareceria depois de o item estar publicado para todo mundo.
 */

import { useMemo, useState } from 'react';
import { Loader2, Plus, Wand2 } from 'lucide-react';
import {
  PROFILE_BORDERS,
  VOCABULARIO_DE_COSMETICOS,
  normalizarCosmeticoAutoral,
  type ChatTitle,
  type CosmeticoAutoral,
  type Pet,
  type Playmat,
  type Sleeve,
} from '@aethertable/shared-types';
import { caminhoDoPet, playmatCanvasDe, sleeveCanvasDe } from '@/cosmetics/render';
import { Avatar } from '@/components/Avatar';
import { mensagemDaApi } from '@/lib/fetcher';
import { useRegistrarCosmetico } from '../../../admin/useAdmin';

/** Tipo do banco → nome da família no contrato. Ver `FAMILIA_POR_TIPO` na API. */
const TIPOS = [
  { tipo: 'SLEEVE', rotulo: 'Protetor (sleeve)' },
  { tipo: 'PLAYMAT', rotulo: 'Tapete (playmat)' },
  { tipo: 'PET', rotulo: 'Mascote' },
  { tipo: 'TITLE', rotulo: 'Título de chat' },
  { tipo: 'BORDER', rotulo: 'Borda de perfil' },
] as const;

type Tipo = (typeof TIPOS)[number]['tipo'];

const FAMILIA: Record<Tipo, string> = {
  SLEEVE: 'sleeveId',
  PLAYMAT: 'playmatId',
  PET: 'petId',
  TITLE: 'titleId',
  BORDER: 'borderId',
};

/**
 * Nome → identificador.
 *
 * O id vai para o estado da sala e para o banco, e o administrador não deveria
 * ter de pensar nele. Derivar do nome dá um id legível ("Trama de Cobre" →
 * `trama-de-cobre`) que ajuda quem for ler a auditoria depois.
 */
function idDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const CAMPOS_INICIAIS: Record<string, string> = {
  cor1: '#2b3350',
  cor2: '#161a2c',
  borda: '#4b5578',
  detalhe: '#7c8ac4',
  destaque: '#7c8ac4',
  cor: '#7c8ac4',
  padrao: 'losango',
  forma: 'slime',
  animacao: 'flutuar',
  badge: 'NOVO',
  classe: PROFILE_BORDERS[1]?.classe ?? PROFILE_BORDERS[0]!.classe,
};

export function CriarCosmetico() {
  const registrar = useRegistrarCosmetico();

  const [tipo, setTipo] = useState<Tipo>('SLEEVE');
  const [nome, setNome] = useState('');
  const [apoiador, setApoiador] = useState(false);
  const [campos, setCampos] = useState<Record<string, string>>(CAMPOS_INICIAIS);

  const id = idDoNome(nome);
  const definir = (k: string, v: string) => setCampos((c) => ({ ...c, [k]: v }));

  /**
   * O item, se os campos formarem um.
   *
   * Passa pelo MESMO normalizador do servidor — então a prévia só aparece
   * quando o item é aceitável de verdade, e "não consigo ver a prévia" e "o
   * servidor vai recusar" viram a mesma condição, em vez de duas regras
   * parecidas que divergem com o tempo.
   */
  const previa: CosmeticoAutoral | null = useMemo(() => {
    if (!id || !nome.trim()) return null;
    return normalizarCosmeticoAutoral({
      ...campos,
      familia: FAMILIA[tipo],
      id,
      nome: nome.trim(),
      tier: apoiador ? 'APOIADOR' : 'FREE',
    });
  }, [campos, id, nome, tipo, apoiador]);

  function enviar() {
    if (!previa) return;
    registrar.mutate(
      {
        catalogoId: id,
        tipo,
        nome: nome.trim(),
        minTier: apoiador ? 1 : 0,
        parametros: campos,
      },
      {
        onSuccess: () => {
          setNome('');
          setCampos(CAMPOS_INICIAIS);
        },
      },
    );
  }

  return (
    <section className="border-panel-border bg-panel rounded-xl border p-4">
      <h2 className="text-text mb-1 flex items-center gap-2 text-base font-bold">
        <Wand2 className="text-primary h-4 w-4" /> Criar um cosmético
      </h2>
      <p className="text-text-muted mb-4 text-xs leading-relaxed">
        Combine as tramas e silhuetas que o cliente já sabe desenhar. Continua sem upload: o que
        entra aqui são cores e um padrão da lista, nunca um arquivo. O item nasce já disponível no
        seletor dos jogadores e concedível como prêmio.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_13rem]">
        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Tipo">
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as Tipo)}
                className={ENTRADA}
              >
                {TIPOS.map((t) => (
                  <option key={t.tipo} value={t.tipo}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Nome" dica={id ? `identificador: ${id}` : 'o identificador sai daqui'}>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={48}
                placeholder="Trama de Cobre"
                className={ENTRADA}
              />
            </Campo>
          </div>

          {tipo === 'SLEEVE' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Cor rotulo="Fundo (externo)" valor={campos.cor1!} ao={(v) => definir('cor1', v)} />
              <Cor rotulo="Fundo (interno)" valor={campos.cor2!} ao={(v) => definir('cor2', v)} />
              <Cor rotulo="Borda da carta" valor={campos.borda!} ao={(v) => definir('borda', v)} />
              <Cor rotulo="Trama" valor={campos.detalhe!} ao={(v) => definir('detalhe', v)} />
              <Campo rotulo="Padrão">
                <select
                  value={campos.padrao}
                  onChange={(e) => definir('padrao', e.target.value)}
                  className={ENTRADA}
                >
                  {VOCABULARIO_DE_COSMETICOS.padraoDeSleeve.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          )}

          {tipo === 'PLAYMAT' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Cor
                rotulo="Gradiente (início)"
                valor={campos.cor1!}
                ao={(v) => definir('cor1', v)}
              />
              <Cor rotulo="Gradiente (fim)" valor={campos.cor2!} ao={(v) => definir('cor2', v)} />
              <Cor
                rotulo="Destaque do padrão"
                valor={campos.destaque!}
                ao={(v) => definir('destaque', v)}
              />
              <Campo rotulo="Padrão">
                <select
                  value={campos.padrao}
                  onChange={(e) => definir('padrao', e.target.value)}
                  className={ENTRADA}
                >
                  {VOCABULARIO_DE_COSMETICOS.padraoDePlaymat.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
          )}

          {tipo === 'PET' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Silhueta">
                <select
                  value={campos.forma}
                  onChange={(e) => definir('forma', e.target.value)}
                  className={ENTRADA}
                >
                  {VOCABULARIO_DE_COSMETICOS.formaDePet
                    .filter((f) => f !== 'nenhum')
                    .map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                </select>
              </Campo>
              <Campo rotulo="Movimento" dica="Discreto por regra: nunca disputa com as cartas.">
                <select
                  value={campos.animacao}
                  onChange={(e) => definir('animacao', e.target.value)}
                  className={ENTRADA}
                >
                  {VOCABULARIO_DE_COSMETICOS.animacaoDePet.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Campo>
              <Cor rotulo="Cor" valor={campos.cor!} ao={(v) => definir('cor', v)} />
            </div>
          )}

          {tipo === 'TITLE' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Insígnia" dica="Até 16 caracteres — ela fica ao lado do nome.">
                <input
                  value={campos.badge}
                  onChange={(e) => definir('badge', e.target.value)}
                  maxLength={16}
                  className={ENTRADA}
                />
              </Campo>
              <Cor rotulo="Cor" valor={campos.cor!} ao={(v) => definir('cor', v)} />
            </div>
          )}

          {tipo === 'BORDER' && (
            <Campo
              rotulo="Contorno"
              dica="O conjunto é fechado: são os contornos que a folha de estilo do cliente define."
            >
              <select
                value={campos.classe}
                onChange={(e) => definir('classe', e.target.value)}
                className={ENTRADA}
              >
                {PROFILE_BORDERS.filter((b) => b.classe).map((b) => (
                  <option key={b.classe} value={b.classe}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          <label className="text-text flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={apoiador}
              onChange={(e) => setApoiador(e.target.checked)}
              className="accent-primary h-4 w-4"
            />
            Exclusivo de apoiadores
          </label>

          <button
            onClick={enviar}
            disabled={!previa || registrar.isPending}
            className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {registrar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Criar e publicar
          </button>

          {registrar.isError && (
            <p className="text-danger text-sm">{mensagemDaApi(registrar.error)}</p>
          )}
        </div>

        {/* ── Prévia ───────────────────────────────────────────────────── */}
        <div className="border-panel-border bg-table-deep flex flex-col items-center justify-center gap-2 rounded-lg border p-3">
          <span className="text-text-muted text-[10px] font-bold uppercase">Prévia</span>
          {previa ? (
            <Previa item={previa} />
          ) : (
            <p className="text-text-faint px-2 text-center text-[11px]">
              Dê um nome ao item para ver como ele fica.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const ENTRADA =
  'bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:outline-none';

function Campo({
  rotulo,
  dica,
  children,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="text-text-muted mb-1.5 block text-[11px] font-bold uppercase">
        {rotulo}
      </label>
      {children}
      {dica && <p className="text-text-faint mt-1 text-[11px]">{dica}</p>}
    </div>
  );
}

/**
 * Seletor de cor nativo mais o hexadecimal escrito.
 *
 * O campo de texto não é enfeite: o administrador quase sempre TEM a cor —
 * veio de uma paleta, de outro item, de um material de divulgação — e obrigá-lo
 * a caçá-la no seletor do sistema operacional é pedir para o valor sair errado
 * por um dígito.
 */
function Cor({ rotulo, valor, ao }: { rotulo: string; valor: string; ao: (v: string) => void }) {
  return (
    <Campo rotulo={rotulo}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(valor) ? valor : '#000000'}
          onChange={(e) => ao(e.target.value)}
          className="border-panel-border h-9 w-10 shrink-0 cursor-pointer rounded border bg-transparent"
        />
        <input
          value={valor}
          onChange={(e) => ao(e.target.value.trim())}
          maxLength={7}
          spellCheck={false}
          className={`${ENTRADA} font-mono`}
        />
      </div>
    </Campo>
  );
}

/** Desenha o item com o mesmo código da mesa. Ver o cabeçalho do arquivo. */
function Previa({ item }: { item: CosmeticoAutoral }) {
  if (item.familia === 'sleeveId') {
    return (
      <ImagemDeCanvas
        canvas={sleeveCanvasDe(item.item as Sleeve)}
        classe="w-24 rounded-md shadow-lg"
      />
    );
  }
  if (item.familia === 'playmatId') {
    return (
      <ImagemDeCanvas
        canvas={playmatCanvasDe(item.item as Playmat)}
        classe="w-full rounded shadow-lg"
      />
    );
  }
  if (item.familia === 'borderId') {
    // A borda é classe CSS: desenhar com o próprio `Avatar` garante que a
    // prévia mostre o mesmo contorno que o painel de vida vai mostrar.
    return <Avatar nome="AT" borderId={item.item.id} tamanho="md" />;
  }
  if (item.familia === 'titleId') {
    const t = item.item as ChatTitle;
    return (
      <span
        className="rounded px-2 py-0.5 text-[11px] font-bold"
        style={{ color: t.cor, border: `1px solid ${t.cor}55`, background: `${t.cor}18` }}
      >
        {t.badge}
      </span>
    );
  }

  const pet = item.item as Pet;
  const pontos = caminhoDoPet(pet);
  if (!pontos) return <span className="text-text-faint text-[11px]">—</span>;
  const R = 20;
  const d = pontos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x * R} ${y * R}`).join(' ') + ' Z';
  return (
    <svg viewBox="-28 -28 56 56" className="h-16 w-16" aria-hidden="true">
      <circle r={R * 1.4} fill={pet.cor} opacity={0.12} />
      <path d={d} fill={pet.cor} opacity={0.85} stroke="rgba(0,0,0,0.4)" strokeWidth={1.5} />
      <circle cx={-R * 0.28} cy={-R * 0.12} r={2.4} fill="#0b0f16" />
      <circle cx={R * 0.28} cy={-R * 0.12} r={2.4} fill="#0b0f16" />
    </svg>
  );
}

/**
 * O canvas vira `<img>` por `toDataURL`.
 *
 * Montar o próprio elemento de canvas no DOM exigiria um ref e um efeito a
 * cada mudança de campo; a imagem é um atributo que o React já sabe trocar.
 */
function ImagemDeCanvas({ canvas, classe }: { canvas: HTMLCanvasElement | null; classe: string }) {
  if (!canvas) return <span className="text-text-faint text-[11px]">—</span>;
  // `<img>` cru e não `next/image`: a fonte é um data URI gerado no navegador
  // a cada tecla, e o otimizador do Next serve arquivos — não há o que otimizar
  // num dado que nunca sai desta aba.
  return <img src={canvas.toDataURL()} alt="" className={classe} />;
}
