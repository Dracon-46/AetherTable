'use client';

/**
 * Comparacao.tsx — duas cartas, uma pergunta: qual tem mais?
 *
 * Serve a dois desafios com o mesmo gesto — "mais jogada em Commander" (a
 * posição no EDHREC, onde MENOR é mais jogada) e "mais cara" (o preço em
 * dólar da Scryfall). A diferença entre eles é só o número e quem vence.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { mensagemDaApi } from '../lib/fetcher';
import { Placar, useRecorde } from './comum';
import { paginaAoAcaso, POPULARES, precoDe, sortearPar, type CartaDoDesafio } from './cartas';

export interface RegraDeComparacao {
  chave: string;
  pergunta: string;
  valor: (c: CartaDoDesafio) => number | null;
  formatar: (v: number) => string;
  /** `true`: o maior vence (preço). `false`: o menor vence (posição no EDHREC). */
  maiorVence: boolean;
  /** Diferença mínima entre os dois, em fração — para não virar cara-ou-coroa. */
  folga: number;
  /** De quantas páginas do topo do EDHREC sortear. */
  paginas: number;
}

export function Comparacao({ regra }: { regra: RegraDeComparacao }) {
  const [par, setPar] = useState<[CartaDoDesafio, CartaDoDesafio] | null>(null);
  const [escolha, setEscolha] = useState<0 | 1 | null>(null);
  const [sequencia, setSequencia] = useState(0);
  const [recorde, registrar] = useRecorde(regra.chave);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const novoPar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setEscolha(null);
    try {
      const cartas = await paginaAoAcaso(POPULARES, regra.paginas);
      const sorteado = sortearPar(cartas, regra.valor, regra.folga);
      if (!sorteado) throw new Error('Não achei duas cartas para comparar. Tente de novo.');
      setPar(sorteado);
    } catch (e) {
      setErro(mensagemDaApi(e));
    } finally {
      setCarregando(false);
    }
  }, [regra]);

  useEffect(() => {
    void novoPar();
  }, [novoPar]);

  const primeiraTemMais = par !== null && regra.valor(par[0])! > regra.valor(par[1])!;
  const vencedora = par ? (primeiraTemMais === regra.maiorVence ? 0 : 1) : null;
  const acertou = escolha !== null && escolha === vencedora;

  const escolher = (i: 0 | 1) => {
    if (escolha !== null || !par) return;
    setEscolha(i);
    if (i === vencedora) {
      const nova = sequencia + 1;
      setSequencia(nova);
      registrar(nova);
    } else {
      setSequencia(0);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text text-lg font-bold">{regra.pergunta}</p>
        <Placar pontos={sequencia} recorde={recorde} />
      </div>

      {erro ? (
        <p className="text-danger text-sm">{erro}</p>
      ) : !par || carregando ? (
        <p className="text-text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Embaralhando…
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          {par.map((c, i) => {
            const certo = escolha !== null && i === vencedora;
            const errado = escolha === i && i !== vencedora;
            return (
              <button
                key={c.id}
                onClick={() => escolher(i as 0 | 1)}
                disabled={escolha !== null}
                aria-label={`Escolher ${c.name}`}
                className={`bg-panel group flex flex-col items-center gap-2 rounded-xl border-2 p-2 transition-colors sm:p-3 ${
                  certo
                    ? 'border-success'
                    : errado
                      ? 'border-danger'
                      : 'border-panel-border hover:border-primary'
                }`}
              >
                <img
                  src={cardImageUrl(c.id, 'normal')}
                  alt={c.name}
                  className="aspect-[5/7] w-full max-w-60 rounded-lg bg-black/20 object-cover"
                />
                <span className="text-text text-center text-xs font-semibold sm:text-sm">
                  {c.name}
                </span>
                {escolha !== null && (
                  <span
                    className={`font-mono text-sm font-bold ${certo ? 'text-success' : 'text-text-muted'}`}
                  >
                    {regra.formatar(regra.valor(c)!)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {escolha !== null && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className={`font-semibold ${acertou ? 'text-success' : 'text-danger'}`}>
            {acertou ? 'Acertou!' : 'Errou — a sequência recomeça.'}
          </p>
          <button
            onClick={() => void novoPar()}
            className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
          >
            <RotateCcw className="h-4 w-4" /> Próximo par
          </button>
        </div>
      )}
    </div>
  );
}

export const MAIS_JOGADA: RegraDeComparacao = {
  chave: 'mais-jogada',
  pergunta: 'Qual é mais jogada em Commander?',
  valor: (c) => c.edhrec_rank ?? null,
  formatar: (v) => `#${v} no EDHREC`,
  maiorVence: false,
  folga: 0.1,
  paginas: 10,
};

export const MAIS_CARA: RegraDeComparacao = {
  chave: 'mais-cara',
  pergunta: 'Qual é a mais cara?',
  valor: precoDe,
  formatar: (v) => `US$ ${v.toFixed(2)}`,
  maiorVence: true,
  folga: 0.15,
  paginas: 8,
};
