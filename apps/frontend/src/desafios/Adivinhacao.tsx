'use client';

/**
 * Adivinhacao.tsx — "adivinhe a carta" e "escada de dicas".
 *
 * Os dois são o mesmo jogo com a ordem das pistas trocada:
 *
 *   - ADIVINHE A CARTA começa pela ARTE, e cada erro acrescenta uma pista
 *     escrita. Três erros e a carta se revela.
 *   - ESCADA DE DICAS começa pela pista mais vaga (a identidade de cor) e sobe
 *     até a arte. Cada degrau usado custa um ponto: acertar com uma dica vale
 *     seis, com todas vale um.
 */

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, RotateCcw } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { mensagemDaApi } from '../lib/fetcher';
import { CampoDeNome, Placar, useRecorde } from './comum';
import {
  nomeConfere,
  paginaAoAcaso,
  POPULARES,
  sortearDe,
  textoSemNome,
  type CartaDoDesafio,
} from './cartas';

const NOME_DA_COR: Record<string, string> = {
  W: 'branco',
  U: 'azul',
  B: 'preto',
  R: 'vermelho',
  G: 'verde',
};

export interface Pista {
  rotulo: string;
  /** Texto, ou `'ARTE'` para a arte da carta. */
  conteudo: string;
}

/** As pistas da escada, da mais vaga para a que entrega a carta. */
export function pistasDaEscada(c: CartaDoDesafio): Pista[] {
  const cores = c.color_identity ?? [];
  return [
    {
      rotulo: 'Identidade de cor',
      conteudo: cores.length ? cores.map((x) => NOME_DA_COR[x] ?? x).join(', ') : 'incolor',
    },
    { rotulo: 'Valor de mana', conteudo: String(c.cmc ?? 0) },
    { rotulo: 'Tipo', conteudo: c.type_line ?? c.card_faces?.[0]?.type_line ?? '—' },
    {
      rotulo: 'Primeira coleção desta impressão',
      conteudo: [c.set_name, c.released_at?.slice(0, 4)].filter(Boolean).join(', ') || '—',
    },
    { rotulo: 'Texto (o nome virou ~)', conteudo: textoSemNome(c) || '(sem texto)' },
    { rotulo: 'Arte', conteudo: 'ARTE' },
  ];
}

/** As pistas de "adivinhe a carta": a arte primeiro, depois três escritas. */
export function pistasDaArte(c: CartaDoDesafio): Pista[] {
  const [cor, mana, tipo] = pistasDaEscada(c);
  return [
    { rotulo: 'Arte', conteudo: 'ARTE' },
    {
      rotulo: `${mana!.rotulo} e ${cor!.rotulo.toLowerCase()}`,
      conteudo: `${mana!.conteudo} · ${cor!.conteudo}`,
    },
    tipo!,
  ];
}

export function Adivinhacao({ modo }: { modo: 'arte' | 'escada' }) {
  const [carta, setCarta] = useState<CartaDoDesafio | null>(null);
  const [reveladas, setReveladas] = useState(1);
  const [fim, setFim] = useState<'acertou' | 'errou' | null>(null);
  const [palpites, setPalpites] = useState<string[]>([]);
  const [pontos, setPontos] = useState(0);
  const [recorde, registrar] = useRecorde(modo === 'arte' ? 'adivinhe' : 'escada');
  const [erro, setErro] = useState<string | null>(null);

  const pistas = carta ? (modo === 'arte' ? pistasDaArte(carta) : pistasDaEscada(carta)) : [];
  // Na arte, três ERROS encerram (a arte e duas pistas); na escada, errar com
  // a última pista à vista encerra.
  const errosPermitidos = modo === 'arte' ? 3 : pistas.length;

  const nova = useCallback(async () => {
    setCarta(null);
    setErro(null);
    setFim(null);
    setPalpites([]);
    setReveladas(1);
    try {
      const cartas = await paginaAoAcaso(POPULARES, modo === 'arte' ? 4 : 3);
      const escolhida = sortearDe(cartas);
      if (!escolhida) throw new Error('Nenhuma carta veio da busca. Tente de novo.');
      setCarta(escolhida);
    } catch (e) {
      setErro(mensagemDaApi(e));
    }
  }, [modo]);

  useEffect(() => {
    void nova();
  }, [nova]);

  const perder = () => {
    setFim('errou');
    setPontos(0);
    setReveladas(pistas.length);
  };

  /** Um degrau a mais, sem palpite — na escada, custa o ponto daquele degrau. */
  const maisUmaDica = () => setReveladas((r) => Math.min(pistas.length, r + 1));

  /** Palpite errado: acaba nas chances ou na última pista; senão, mais uma pista. */
  const errar = (erros: number) => {
    if (erros >= errosPermitidos || reveladas >= pistas.length) perder();
    else maisUmaDica();
  };

  const chutar = (nome: string) => {
    if (!carta || fim) return;
    if (nomeConfere(carta, nome)) {
      setFim('acertou');
      // Arte: um ponto por carta. Escada: quanto menos degraus, mais pontos.
      const ganho = modo === 'arte' ? 1 : pistas.length + 1 - reveladas;
      const total = pontos + ganho;
      setPontos(total);
      registrar(total);
      return;
    }
    setPalpites((p) => [...p, nome]);
    errar(palpites.length + 1);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text text-lg font-bold">
          {modo === 'arte'
            ? 'De que carta é esta arte?'
            : 'Que carta é esta? Suba a escada de dicas.'}
        </p>
        <Placar
          pontos={pontos}
          recorde={recorde}
          rotulo={modo === 'arte' ? 'Sequência' : 'Pontos'}
        />
      </div>

      {erro ? (
        <p className="text-danger text-sm">{erro}</p>
      ) : !carta ? (
        <p className="text-text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Escolhendo uma carta…
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="space-y-2">
            {pistas.slice(0, reveladas).map((p, i) => (
              <li key={p.rotulo} className="bg-panel border-panel-border rounded-lg border p-3">
                <p className="text-text-faint mb-1 text-[11px] font-semibold uppercase tracking-wider">
                  {modo === 'escada' ? `Degrau ${i + 1} · ` : ''}
                  {p.rotulo}
                </p>
                {p.conteudo === 'ARTE' ? (
                  <img
                    src={cardImageUrl(carta.id, 'art_crop')}
                    alt="Arte da carta"
                    className="w-full rounded-md bg-black/20 object-cover"
                  />
                ) : (
                  <p className="text-text whitespace-pre-line text-sm">{p.conteudo}</p>
                )}
              </li>
            ))}
          </ol>

          <div className="space-y-3">
            {fim ? (
              <div className="space-y-3">
                <p
                  className={`font-semibold ${fim === 'acertou' ? 'text-success' : 'text-danger'}`}
                >
                  {fim === 'acertou' ? 'Acertou!' : 'Não foi dessa vez.'} Era{' '}
                  <strong>{carta.name}</strong>.
                </p>
                <img
                  src={cardImageUrl(carta.id, 'normal')}
                  alt={carta.name}
                  className="aspect-[5/7] w-full max-w-64 rounded-lg bg-black/20 object-cover"
                />
                <button
                  onClick={() => void nova()}
                  className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                >
                  <RotateCcw className="h-4 w-4" /> Outra carta
                </button>
              </div>
            ) : (
              <>
                <CampoDeNome onPalpite={chutar} />
                <div className="flex flex-wrap gap-2">
                  {reveladas < pistas.length && (
                    <button
                      onClick={maisUmaDica}
                      className="border-panel-border text-text-muted hover:text-text hover:bg-panel-hover flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" /> Mais uma dica
                    </button>
                  )}
                  <button
                    onClick={perder}
                    className="text-text-faint hover:text-text-muted px-3 py-1.5 text-xs"
                  >
                    Desistir
                  </button>
                </div>
                {palpites.length > 0 && (
                  <p className="text-text-muted text-xs">
                    Já tentou: {palpites.join(', ')} · restam{' '}
                    {Math.max(0, errosPermitidos - palpites.length)} chance(s)
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
