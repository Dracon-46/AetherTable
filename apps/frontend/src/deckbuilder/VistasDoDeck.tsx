'use client';

/**
 * VistasDoDeck.tsx — as maneiras de olhar a lista de um grimório.
 *
 * ─── POR QUE TRÊS VISTAS, E NÃO DUAS ───────────────────────────────────────
 *
 * Havia "Edição em Lista" e "Galeria Visual", e as duas respondem à mesma
 * pergunta ("o que tem no deck?") gastando quantidades muito diferentes de
 * tela. Faltava a pergunta do meio, que é a mais frequente na hora de ajustar
 * uma lista: "quero ver AS CEM de uma vez". Na vista de lista, cem cartas com
 * 68 px de altura cada são 6.800 px de rolagem; na galeria, são vinte telas de
 * arte. Nenhuma das duas deixa a lista inteira visível.
 *
 * A vista COMPACTA existe para isso: uma linha por carta, em colunas, com o
 * essencial (quantidade, nome, set) e os controles no hover. Cem cartas cabem
 * em uma tela e meia.
 *
 * ─── E POR QUE OS COMPONENTES SÃO MEMOIZADOS ───────────────────────────────
 *
 * A lista inteira era JSX inline no corpo da página. Qualquer estado que
 * mudasse ali — uma tecla no campo de busca do painel esquerdo, abrir o
 * seletor de arte — reconstruía as cem linhas. Com `React.memo` e handlers
 * estáveis, uma mudança de quantidade re-renderiza UMA linha.
 */

import React from 'react';
import {
  ArrowLeftRight,
  Crown,
  Trash2,
  Plus as PlusIcon,
  Minus as MinusIcon,
  Image as ImageIcon,
  Loader2,
  Copy,
} from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { useToast } from '../components/Toast';
import { quantidadeValida } from './CardSearch';
import type { DeckCarta } from './useDecks';

export interface AcoesDeCarta {
  /** `null` em modo de leitura: a vista não desenha controle nenhum. */
  onMudarQuantidade: ((cardId: string, delta: number) => void) | null;
  onRemover: ((cardId: string) => void) | null;
  onAlternarComandante: ((cardId: string, boardType: string) => void) | null;
  onTrocarArte: ((carta: DeckCarta) => void) | null;
  /**
   * Entre o deck principal e a reserva. O backend sempre aceitou qualquer
   * `boardType`; a tela só sabia alternar comandante, e a reserva só se
   * preenchia pela importação.
   */
  onAlternarReserva?: ((cardId: string, boardType: string) => void) | null;
}

/** O botão de reserva, igual nas três vistas — muda só o tamanho. */
function BotaoDeReserva({
  carta,
  acoes,
  className,
  tamanho = 'h-3.5 w-3.5',
}: {
  carta: DeckCarta;
  acoes: AcoesDeCarta;
  className: string;
  tamanho?: string;
}) {
  if (!acoes.onAlternarReserva || carta.boardType === 'COMMANDER') return null;
  const naReserva = carta.boardType === 'SIDEBOARD';
  return (
    <button
      onClick={() => acoes.onAlternarReserva?.(carta.id, carta.boardType)}
      className={`${className} ${naReserva ? 'text-warning' : ''}`}
      title={naReserva ? 'Voltar para o deck principal' : 'Mandar para a reserva'}
      aria-label={naReserva ? 'Voltar para o deck principal' : 'Mandar para a reserva'}
    >
      <ArrowLeftRight className={tamanho} />
    </button>
  );
}

/**
 * Copia o nome da carta — para colar numa busca, num site de preços, numa
 * conversa. Vale também em modo de leitura: copiar não muda o deck.
 */
function BotaoCopiarNome({
  nome,
  className,
  tamanho = 'h-3.5 w-3.5',
}: {
  nome: string | undefined;
  className: string;
  tamanho?: string;
}) {
  const avisar = useToast((s) => s.mostrar);
  if (!nome) return null;
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(nome);
          avisar(`"${nome}" copiado.`, 'sucesso');
        } catch {
          avisar('O navegador negou a área de transferência.', 'erro');
        }
      }}
      className={className}
      title="Copiar o nome"
      aria-label={`Copiar o nome de ${nome}`}
    >
      <Copy className={tamanho} />
    </button>
  );
}

/**
 * A quantidade, digitável. Com só "+" e "−", pôr 30 Relentless Rats (ou
 * acertar 14 Florestas) eram dezenas de cliques. O número vai ao servidor como
 * a diferença para o valor atual, pela mesma rota do "+": ao sair do campo ou
 * no Enter — nunca a cada tecla (ver o campo de quantidade da busca).
 */
function CampoDeQuantidade({
  carta,
  acoes,
  className,
}: {
  carta: DeckCarta;
  acoes: AcoesDeCarta;
  className: string;
}) {
  const [texto, setTexto] = React.useState(String(carta.quantity));
  // A quantidade muda por fora (o "+", a reconciliação com o servidor).
  React.useEffect(() => setTexto(String(carta.quantity)), [carta.quantity]);

  // Esc desiste: o `blur` que vem em seguida não pode confirmar o digitado.
  const desistiu = React.useRef(false);

  const confirmar = () => {
    if (desistiu.current) {
      desistiu.current = false;
      setTexto(String(carta.quantity));
      return;
    }
    const n = quantidadeValida(texto);
    setTexto(String(n));
    if (n !== carta.quantity) acoes.onMudarQuantidade?.(carta.id, n - carta.quantity);
  };

  return (
    <input
      type="number"
      min={1}
      max={99}
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          desistiu.current = true;
          e.currentTarget.blur();
        }
      }}
      aria-label={`Quantidade de ${carta.name ?? 'carta'}`}
      className={`[appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${className}`}
    />
  );
}

/** `true` quando a carta ainda não tem id do servidor — nenhum botão funciona. */
const semId = (carta: DeckCarta) => Boolean(carta.pendente);

// ─── Vista: lista de edição ──────────────────────────────────────────────────

export const LinhaDeCarta = React.memo(function LinhaDeCarta({
  carta,
  acoes,
}: {
  carta: DeckCarta;
  acoes: AcoesDeCarta;
}) {
  const comandante = carta.boardType === 'COMMANDER';
  const podeEditar = Boolean(acoes.onMudarQuantidade) && !semId(carta);

  return (
    <div
      className={`hover:border-primary group flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors sm:p-3 ${
        comandante ? 'bg-primary/5 border-primary/30' : 'bg-table-deep border-panel-border'
      } ${semId(carta) ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        disabled={!acoes.onTrocarArte || semId(carta)}
        onClick={() => acoes.onTrocarArte?.(carta)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
      >
        <span className="text-primary w-7 shrink-0 text-right font-bold">{carta.quantity}x</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={`flex items-center gap-2 truncate text-sm font-semibold transition-colors ${
              carta.isBanned
                ? 'text-danger line-through'
                : comandante
                  ? 'text-primary'
                  : 'text-text'
            } ${acoes.onTrocarArte ? 'group-hover:text-primary' : ''}`}
          >
            <span className="truncate">{carta.name ?? 'Resolvendo...'}</span>
            {comandante && <Crown className="text-primary h-3.5 w-3.5 shrink-0" />}
            {carta.isBanned && (
              <span className="bg-danger shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase text-white">
                Banida
              </span>
            )}
            {semId(carta) ? (
              <Loader2 className="text-text-faint h-3 w-3 shrink-0 animate-spin" />
            ) : (
              acoes.onTrocarArte && (
                <ImageIcon className="text-text-faint h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              )
            )}
          </span>
          <span className="text-text-faint truncate text-xs">{carta.typeLine}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <BotaoCopiarNome
          nome={carta.name}
          className="text-text-muted hover:text-primary p-1 transition-opacity sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
        />
        <span className="text-primary bg-primary/10 hidden rounded px-2 py-1 font-mono text-[10px] sm:inline">
          [{carta.set ?? '???'}]
        </span>
        {podeEditar && (
          <div className="bg-table-deep border-panel-border flex items-center overflow-hidden rounded border">
            <button
              onClick={() => acoes.onAlternarComandante?.(carta.id, carta.boardType)}
              className={`p-1.5 transition-colors ${
                comandante
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:text-primary hover:bg-primary/10'
              }`}
              title={comandante ? 'Remover do Comando' : 'Tornar Comandante'}
            >
              <Crown className="h-3.5 w-3.5" />
            </button>
            <BotaoDeReserva
              carta={carta}
              acoes={acoes}
              className="text-text-muted hover:text-primary hover:bg-primary/10 p-1.5 transition-colors"
            />
            <span className="bg-panel-border mx-0.5 h-4 w-px" />
            <button
              onClick={() => acoes.onMudarQuantidade?.(carta.id, -1)}
              className="hover:bg-danger/20 hover:text-danger text-text-muted p-1.5 transition-colors"
              title="Diminuir"
            >
              <MinusIcon className="h-3 w-3" />
            </button>
            <CampoDeQuantidade
              carta={carta}
              acoes={acoes}
              className="text-text focus:bg-panel w-7 bg-transparent px-0.5 text-center text-xs font-bold"
            />
            <button
              onClick={() => acoes.onMudarQuantidade?.(carta.id, 1)}
              className="hover:bg-success/20 hover:text-success text-text-muted p-1.5 transition-colors"
              title="Aumentar"
            >
              <PlusIcon className="h-3 w-3" />
            </button>
            <button
              onClick={() => acoes.onRemover?.(carta.id)}
              className="bg-danger/10 text-danger hover:bg-danger ml-1 p-1.5 transition-colors hover:text-white"
              title="Remover todas"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Vista: compacta ─────────────────────────────────────────────────────────

/**
 * Uma linha por carta, sem linha de tipo e sem moldura.
 *
 * A quantidade fica à esquerda, monoespaçada e alinhada à direita, porque numa
 * lista de cem itens o olho procura a coluna de números antes de procurar
 * nomes — é assim que se confere um deck.
 */
export const LinhaCompacta = React.memo(function LinhaCompacta({
  carta,
  acoes,
}: {
  carta: DeckCarta;
  acoes: AcoesDeCarta;
}) {
  const comandante = carta.boardType === 'COMMANDER';
  const podeEditar = Boolean(acoes.onMudarQuantidade) && !semId(carta);

  return (
    <div
      className={`hover:bg-panel-hover group flex items-center gap-2 rounded px-2 py-1 transition-colors ${
        semId(carta) ? 'opacity-60' : ''
      }`}
    >
      <span className="text-primary w-6 shrink-0 text-right font-mono text-xs font-bold">
        {carta.quantity}
      </span>
      <button
        type="button"
        disabled={!acoes.onTrocarArte || semId(carta)}
        onClick={() => acoes.onTrocarArte?.(carta)}
        className={`min-w-0 flex-1 truncate text-left text-xs ${
          carta.isBanned
            ? 'text-danger line-through'
            : comandante
              ? 'text-primary font-semibold'
              : 'text-text'
        } ${acoes.onTrocarArte ? 'group-hover:text-primary' : ''} disabled:cursor-default`}
        title={carta.name}
      >
        {comandante && '👑 '}
        {carta.name ?? 'Resolvendo...'}
      </button>
      <span className="text-text-faint hidden shrink-0 font-mono text-[10px] sm:inline">
        {carta.set ?? '???'}
      </span>
      <BotaoCopiarNome
        nome={carta.name}
        tamanho="h-3 w-3"
        className="text-text-muted hover:text-primary pointer-events-none shrink-0 px-1 opacity-0 transition-opacity focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      />
      {podeEditar && (
        // Os controles só aparecem no hover/foco: com cem linhas na tela, seis
        // botões por linha viram seiscentos botões competindo com os nomes.
        //
        // ─── INVISÍVEL NÃO É INALCANÇÁVEL ───────────────────────────────────
        // `opacity-0` esconde e continua recebendo toque: no celular, quem
        // tocava a linha acertava um "−" que não via e uma cópia única sumia
        // do deck. `pointer-events-none` fecha isso. E como tela de toque não
        // tem hover (o `hover:` do Tailwind 4 só vale com `(hover: hover)`),
        // lá os controles ficam à vista — senão não haveria como alcançá-los.
        <span className="pointer-events-none flex shrink-0 items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          <button
            onClick={() => acoes.onMudarQuantidade?.(carta.id, -1)}
            className="text-text-muted hover:text-danger px-1"
            title="Diminuir"
          >
            <MinusIcon className="h-3 w-3" />
          </button>
          <button
            onClick={() => acoes.onMudarQuantidade?.(carta.id, 1)}
            className="text-text-muted hover:text-success px-1"
            title="Aumentar"
          >
            <PlusIcon className="h-3 w-3" />
          </button>
          <button
            onClick={() => acoes.onAlternarComandante?.(carta.id, carta.boardType)}
            className={`px-1 ${comandante ? 'text-primary' : 'text-text-muted hover:text-primary'}`}
            title={comandante ? 'Remover do Comando' : 'Tornar Comandante'}
          >
            <Crown className="h-3 w-3" />
          </button>
          <BotaoDeReserva
            carta={carta}
            acoes={acoes}
            className="text-text-muted hover:text-primary px-1"
            tamanho="h-3 w-3"
          />
          <button
            onClick={() => acoes.onRemover?.(carta.id)}
            className="text-text-muted hover:text-danger px-1"
            title="Remover todas"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  );
});

// ─── Vista: galeria ──────────────────────────────────────────────────────────

export const ArteDeCarta = React.memo(function ArteDeCarta({
  carta,
  acoes,
}: {
  carta: DeckCarta;
  acoes: AcoesDeCarta;
}) {
  const comandante = carta.boardType === 'COMMANDER';
  const podeEditar = Boolean(acoes.onMudarQuantidade) && !semId(carta);

  /**
   * ─── O TOQUE NA ARTE ACERTAVA BOTÕES QUE NINGUÉM VIA ─────────────────────
   *
   * A sobreposição de controles era só `opacity-0`: invisível, mas cobrindo a
   * carta inteira e recebendo toque. No celular, tocar a arte para olhá-la
   * acertava "Comandante" (bem no centro) ou o "−" de uma cópia única, e a
   * carta mudava de zona ou sumia do deck sem a pessoa ter visto botão nenhum.
   *
   * Agora a sobreposição não recebe ponteiro enquanto está escondida. Com
   * mouse, o hover a revela como antes; no toque — que não tem hover — o
   * primeiro toque na arte a ABRE e só o seguinte age. Teclado continua pelo
   * `focus-within`. O tipo de ponteiro é lembrado no `pointerdown` porque um
   * clique de mouse no fundo da sobreposição não deve fixá-la aberta: para o
   * mouse, quem decide é o hover.
   */
  const [aberto, setAberto] = React.useState(false);
  const ultimoPonteiro = React.useRef<string | null>(null);

  const aoTocarNaArte = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!podeEditar || ultimoPonteiro.current === 'mouse') return;
    // Toque num botão já é a ação; alternar junto fecharia o painel embaixo
    // do dedo a cada "+".
    if ((e.target as HTMLElement).closest('button')) return;
    setAberto((v) => !v);
  };

  return (
    <div
      className="group/card relative"
      onPointerDown={(e) => {
        ultimoPonteiro.current = e.pointerType;
      }}
      onClick={aoTocarNaArte}
    >
      {/* Pelo proxy da API. O `imageNormal` que o backend devolve aponta para
          `cards.scryfall.io` — domínio que a rede do usuário pode bloquear. */}
      <img
        src={cardImageUrl(carta.scryfallId, 'normal')}
        alt={carta.name ?? 'Carta'}
        // `aspect-[5/7]` é a proporção de uma carta de Magic. Sem ela, a grade
        // pulava enquanto as imagens chegavam uma a uma: cada `<img>` sem
        // dimensão nasce com altura zero e empurra tudo ao carregar.
        className={`aspect-[5/7] w-full rounded-lg border-2 bg-black/20 object-cover shadow-md transition-colors ${
          comandante
            ? 'border-primary shadow-primary/30'
            : 'group-hover/card:border-primary border-transparent'
        }`}
        loading="lazy"
        decoding="async"
      />
      <span
        className={`absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold shadow-lg ${
          comandante ? 'bg-primary border-primary text-white' : 'bg-panel border-panel-border'
        }`}
      >
        {carta.quantity}
      </span>
      {comandante && (
        <span className="bg-primary border-primary absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-lg">
          <Crown className="h-3.5 w-3.5" />
        </span>
      )}
      {podeEditar && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/60 backdrop-blur-[2px] transition-opacity ${
            aberto
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100'
          }`}
        >
          {/* Quantidade direto na arte: na galeria, o caminho anterior para
              mudar de 1 para 2 era voltar para a vista de lista. */}
          <div className="flex items-center gap-1 rounded-full bg-black/70 px-1">
            <button
              onClick={() => acoes.onMudarQuantidade?.(carta.id, -1)}
              className="p-1.5 text-white/80 transition-colors hover:text-white"
              title="Diminuir"
            >
              <MinusIcon className="h-3.5 w-3.5" />
            </button>
            <CampoDeQuantidade
              carta={carta}
              acoes={acoes}
              className="w-6 bg-transparent text-center font-mono text-xs font-bold text-white"
            />
            <button
              onClick={() => acoes.onMudarQuantidade?.(carta.id, 1)}
              className="p-1.5 text-white/80 transition-colors hover:text-white"
              title="Aumentar"
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            onClick={() => acoes.onAlternarComandante?.(carta.id, carta.boardType)}
            className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-colors ${
              comandante ? 'bg-danger/80 hover:bg-danger' : 'bg-primary/80 hover:bg-primary'
            }`}
          >
            <Crown className="h-3 w-3" /> {comandante ? 'Despromover' : 'Comandante'}
          </button>
          <BotaoDeReserva
            carta={carta}
            acoes={acoes}
            className="rounded bg-black/80 px-2 py-1.5 text-white shadow-lg transition-colors hover:bg-black"
            tamanho="h-3 w-3"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => acoes.onRemover?.(carta.id)}
              className="bg-danger/80 hover:bg-danger rounded-full p-2 text-white shadow-lg transition-all hover:scale-110"
              title="Remover carta"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => acoes.onTrocarArte?.(carta)}
              className="flex items-center gap-1 rounded bg-black/80 px-2 py-2 text-[10px] font-bold text-white transition-colors hover:bg-black"
              title="Escolher outra impressão"
            >
              <ImageIcon className="h-3 w-3" /> Arte
            </button>
            <BotaoCopiarNome
              nome={carta.name}
              tamanho="h-3 w-3"
              className="rounded bg-black/80 px-2 py-2 text-white transition-colors hover:bg-black"
            />
          </div>
        </div>
      )}
      {/* Em modo de leitura a arte não tem sobreposição nenhuma, mas o nome
          continua precisando de um lugar: a arte pode não ter carregado. */}
      {!podeEditar && (
        <span className="sr-only">
          {carta.quantity}x {carta.name}
        </span>
      )}
    </div>
  );
});
