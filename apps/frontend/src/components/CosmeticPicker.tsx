'use client';

/**
 * CosmeticPicker.tsx — escolha de cosméticos com prévia ao vivo.
 *
 * O catálogo é FECHADO (DOC-060 §1.1) e vive em código: não há upload, não há
 * URL, não há caminho para arte de terceiros entrar na mesa. Cada item é
 * desenhado aqui pelo mesmo código que desenha na mesa — a prévia não é uma
 * aproximação, é o resultado.
 */

import React, { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import {
  listarBorders,
  listarPets,
  listarPlaymats,
  listarSleeves,
  listarTitles,
  acharPet,
  podeEquipar,
  type FamiliaDeCosmetico,
} from '@aethertable/shared-types';
import { caminhoDoPet, playmatCanvas, sleeveCanvas } from '../cosmetics/render';
import { useCosmeticos } from '../cosmetics/store';
import { Avatar } from './Avatar';
import { useCatalogoDeCosmeticos } from '../cosmetics/useCatalogo';

/** Desenha um canvas procedural dentro de um elemento. */
function Previa({
  fonte,
  className,
  proporcao,
}: {
  fonte: HTMLCanvasElement | null;
  className?: string;
  proporcao: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren();
    if (!fonte) return;
    // Clona: o canvas do cache é compartilhado com a mesa e não pode ser
    // movido de container em container.
    const copia = document.createElement('canvas');
    copia.width = fonte.width;
    copia.height = fonte.height;
    copia.getContext('2d')?.drawImage(fonte, 0, 0);
    copia.className = 'h-full w-full object-cover';
    host.appendChild(copia);
  }, [fonte]);

  return <div ref={ref} className={`overflow-hidden ${proporcao} ${className ?? ''}`} />;
}

/**
 * ─── O CADEADO ERA DECORATIVO ─────────────────────────────────────────────────
 *
 * Ele desenhava um ícone e nada mais: o `<button>` não recebia `disabled`, o
 * DTO do backend validava só a existência do id no catálogo, e `updateUser`
 * gravava o que chegasse. Qualquer conta equipava qualquer item de apoiador.
 *
 * Agora ele reflete uma regra que existe dos dois lados —
 * `podeEquipar(tier, familia, id)` em `shared-types`, chamada aqui e no
 * servidor. Uma segunda implementação divergiria no primeiro item novo do
 * catálogo, e a divergência apareceria como um item que a tela deixa clicar e
 * a API recusa.
 */
function Cadeado({ travado }: { travado: boolean }) {
  if (!travado) return null;
  return (
    <span
      className="text-warning absolute right-1 top-1 rounded bg-black/70 p-1"
      title="Item de apoiador — a plataforma é gratuita; cosméticos retribuem quem apoia (DOC-060 §1)"
    >
      <Lock className="h-3 w-3" />
    </span>
  );
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function Secao({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-panel-border bg-panel rounded-xl border p-4 sm:p-5">
      <h3 className="text-text text-base font-bold">{titulo}</h3>
      <p className="text-text-muted mb-3 text-xs">{descricao}</p>
      {children}
    </section>
  );
}

const cardBase =
  'relative flex flex-col overflow-hidden rounded-lg border p-1.5 text-left transition-all hover:-translate-y-0.5';

export function CosmeticPicker() {
  // Assina a versão do catálogo: sem isto, um cosmético criado no backoffice só
  // apareceria neste seletor depois de recarregar a página.
  useCatalogoDeCosmeticos();

  const equipado = useCosmeticos();
  const equipar = useCosmeticos((s) => s.equipar);
  const tier = useCosmeticos((s) => s.tier);

  /** A mesma regra que o servidor aplica — ver `podeEquipar`. */
  const travado = (familia: FamiliaDeCosmetico, id: string) => !podeEquipar(tier, familia, id);

  const sel = (ativo: boolean, bloqueado: boolean) =>
    `${cardBase} ${
      bloqueado
        ? 'border-panel-border bg-table-deep cursor-not-allowed opacity-45 hover:translate-y-0'
        : ativo
          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20'
          : 'border-panel-border bg-table-deep hover:border-panel-hover'
    }`;

  /** O motivo fica no `title`: um botão cinza sem explicação parece defeito. */
  const motivo = (bloqueado: boolean) =>
    bloqueado
      ? 'Exclusivo de apoiadores. A plataforma é gratuita; isto retribui quem apoia.'
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Secao
        titulo="Protetores (sleeves)"
        descricao="O verso das suas cartas na mesa. Todos são desenhados pela própria plataforma — o verso oficial de Magic é da WotC e não é usado aqui."
      >
        <Grade>
          {listarSleeves().map((s) => (
            <button
              key={s.id}
              onClick={() => equipar({ sleeveId: s.id })}
              disabled={travado('sleeveId', s.id)}
              title={motivo(travado('sleeveId', s.id))}
              className={sel(equipado.sleeveId === s.id, travado('sleeveId', s.id))}
            >
              <Cadeado travado={travado('sleeveId', s.id)} />
              <Previa fonte={sleeveCanvas(s.id)} proporcao="aspect-[63/88] rounded" />
              <span className="text-text mt-1.5 truncate px-0.5 text-[11px]">{s.nome}</span>
            </button>
          ))}
        </Grade>
      </Secao>

      <Secao
        titulo="Playmats"
        descricao="O fundo da sua área de jogo. Os oponentes veem o seu playmat só na sua faixa da mesa, sempre com um véu escuro para a carta não se perder no fundo."
      >
        <Grade>
          {listarPlaymats().map((p) => (
            <button
              key={p.id}
              onClick={() => equipar({ playmatId: p.id })}
              disabled={travado('playmatId', p.id)}
              title={motivo(travado('playmatId', p.id))}
              className={sel(equipado.playmatId === p.id, travado('playmatId', p.id))}
            >
              <Cadeado travado={travado('playmatId', p.id)} />
              <Previa fonte={playmatCanvas(p.id)} proporcao="aspect-[3/1] rounded" />
              <span className="text-text mt-1.5 truncate px-0.5 text-[11px]">{p.nome}</span>
            </button>
          ))}
        </Grade>
      </Secao>

      <Secao
        titulo="Bordas de perfil"
        descricao="Contorno do seu avatar no painel de vida, no lobby e no perfil."
      >
        <Grade>
          {listarBorders().map((b) => (
            <button
              key={b.id}
              onClick={() => equipar({ borderId: b.id })}
              disabled={travado('borderId', b.id)}
              title={motivo(travado('borderId', b.id))}
              className={sel(equipado.borderId === b.id, travado('borderId', b.id))}
            >
              <Cadeado travado={travado('borderId', b.id)} />
              <div className="flex items-center justify-center py-3">
                <Avatar nome="AT" borderId={b.id} tamanho="md" />
              </div>
              <span className="text-text truncate px-0.5 text-[11px]">{b.nome}</span>
            </button>
          ))}
        </Grade>
      </Secao>

      <Secao
        titulo="Título de chat"
        descricao="Uma insígnia ao lado do seu nome nas mensagens e no painel de vida."
      >
        <Grade>
          {listarTitles().map((t) => (
            <button
              key={t.id}
              onClick={() => equipar({ titleId: t.id })}
              disabled={travado('titleId', t.id)}
              title={motivo(travado('titleId', t.id))}
              className={sel(equipado.titleId === t.id, travado('titleId', t.id))}
            >
              <Cadeado travado={travado('titleId', t.id)} />
              <div className="flex items-center justify-center py-4">
                {t.badge ? (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: t.cor, backgroundColor: `${t.cor}22` }}
                  >
                    {t.badge}
                  </span>
                ) : (
                  <span className="text-text-faint text-[11px]">—</span>
                )}
              </div>
              <span className="text-text truncate px-0.5 text-[11px]">{t.nome}</span>
            </button>
          ))}
        </Grade>
      </Secao>

      <Secao
        titulo="Mascote"
        descricao="Um companheiro discreto no canto da sua faixa da mesa. Nunca cobre carta nem disputa atenção com o jogo."
      >
        <Grade>
          {listarPets().map((p) => (
            <button
              key={p.id}
              onClick={() => equipar({ petId: p.id })}
              disabled={travado('petId', p.id)}
              title={motivo(travado('petId', p.id))}
              className={sel(equipado.petId === p.id, travado('petId', p.id))}
            >
              <Cadeado travado={travado('petId', p.id)} />
              <div className="flex h-16 items-center justify-center">
                <PreviaPet petId={p.id} />
              </div>
              <span className="text-text truncate px-0.5 text-[11px]">{p.nome}</span>
            </button>
          ))}
        </Grade>
      </Secao>

      <Secao
        titulo="Acessibilidade"
        descricao="Playmats e sleeves de outras pessoas mudam o contraste da sua tela. Esta opção é local: vale só para você."
      >
        <label className="bg-table-deep flex cursor-pointer items-center gap-3 rounded-lg p-3">
          <input
            type="checkbox"
            checked={!equipado.cosmeticosDeOponentes}
            onChange={(e) => useCosmeticos.getState().setCosmeticosDeOponentes(!e.target.checked)}
            className="accent-primary h-4 w-4"
          />
          <span className="text-text text-sm">
            Desativar cosméticos de oponentes
            <span className="text-text-muted block text-xs">
              Todos os outros jogadores passam a ser desenhados com o visual padrão.
            </span>
          </span>
        </label>
      </Secao>
    </div>
  );
}

/** Silhueta estática do mascote — a animação fica para a mesa. */
function PreviaPet({ petId }: { petId: string }) {
  const pet = acharPet(petId);
  const pontos = caminhoDoPet(pet);
  if (!pontos) return <span className="text-text-faint text-[11px]">—</span>;

  const R = 20;
  const d = pontos.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x * R} ${y * R}`).join(' ') + ' Z';

  return (
    <svg viewBox="-28 -28 56 56" className="h-14 w-14" aria-hidden="true">
      <circle r={R * 1.4} fill={pet.cor} opacity={0.12} />
      <path d={d} fill={pet.cor} opacity={0.85} stroke="rgba(0,0,0,0.4)" strokeWidth={1.5} />
      <circle cx={-R * 0.28} cy={-R * 0.12} r={2.4} fill="#0b0f16" />
      <circle cx={R * 0.28} cy={-R * 0.12} r={2.4} fill="#0b0f16" />
    </svg>
  );
}
