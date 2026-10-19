'use client';

/**
 * comum.tsx — o que os cinco desafios dividem: o campo de nome com
 * autocompletar e o placar.
 *
 * O recorde e a sequência saíram daqui: o `useRecorde` guardava só o
 * recorde, e só neste navegador. Agora os dois seguem a conta — ver
 * `progresso.ts`.
 */

import { useEffect, useId, useState } from 'react';
import { Flame, Trophy } from 'lucide-react';
import { api } from '../lib/fetcher';

export function Placar({
  pontos,
  recorde,
  rotulo = 'Sequência',
}: {
  pontos: number;
  recorde: number;
  rotulo?: string;
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-text flex items-center gap-1.5 font-semibold">
        <Flame className="text-warning h-4 w-4" /> {rotulo}: {pontos}
      </span>
      <span className="text-text-muted flex items-center gap-1.5">
        <Trophy className="text-primary h-4 w-4" /> Recorde: {recorde}
      </span>
    </div>
  );
}

/**
 * O campo onde se digita o nome de uma carta. Sugere nomes a partir de duas
 * letras (o mesmo autocompletar do deckbuilder), mas aceita o que for digitado:
 * quem confere é o desafio, e conferir o nome normalizado perdoa acento e
 * maiúscula.
 */
export function CampoDeNome({
  onPalpite,
  desabilitado = false,
  rotulo = 'Seu palpite',
  textoDoBotao = 'Chutar',
}: {
  onPalpite: (nome: string) => void;
  desabilitado?: boolean;
  rotulo?: string;
  textoDoBotao?: string;
}) {
  const [texto, setTexto] = useState('');
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const lista = useId();

  useEffect(() => {
    const termo = texto.trim();
    if (termo.length < 2) {
      setSugestoes([]);
      return;
    }
    const controle = new AbortController();
    const t = setTimeout(() => {
      api<{ data?: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(termo)}`, {
        signal: controle.signal,
      })
        .then((r) => setSugestoes((r.data ?? []).slice(0, 10)))
        .catch(() => {
          /* sem sugestão; o palpite digitado continua valendo */
        });
    }, 250);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [texto]);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const nome = texto.trim();
        if (!nome || desabilitado) return;
        onPalpite(nome);
        setTexto('');
      }}
    >
      <input
        type="text"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        list={lista}
        disabled={desabilitado}
        aria-label={rotulo}
        placeholder="Nome da carta (em inglês)…"
        autoComplete="off"
        className="bg-table-deep border-panel-border text-text focus:border-primary min-w-0 flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
      />
      <datalist id={lista}>
        {sugestoes.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="submit"
        disabled={desabilitado || !texto.trim()}
        className="bg-primary hover:bg-primary-hover shrink-0 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {textoDoBotao}
      </button>
    </form>
  );
}
