'use client';

/**
 * Desafios — passatempos com cartas de verdade, entre uma partida e outra.
 *
 * Cinco jogos curtos, todos com as cartas mais jogadas em Commander (o topo do
 * EDHREC, pela busca da Scryfall da API). O recorde e a sequência em curso de
 * cada um seguem a conta (`desafios/progresso.ts`): trocar de PC não zera, e
 * recarregar no meio de uma pergunta conta como desistir dela.
 */

import { useState } from 'react';
import { Coins, Grid3x3, Image as ImageIcon, ListOrdered, Puzzle, TrendingUp } from 'lucide-react';
import { Adivinhacao } from '../../../desafios/Adivinhacao';
import { Comparacao, MAIS_CARA, MAIS_JOGADA } from '../../../desafios/Comparacao';
import { GradeDeCriaturas } from '../../../desafios/GradeDeCriaturas';
import { useT } from '../../../i18n/i18n';

const JOGOS = [
  {
    id: 'arte',
    nome: 'Adivinhe a carta',
    resumo: 'Pela arte, com três chances.',
    Icone: ImageIcon,
  },
  {
    id: 'escada',
    nome: 'Escada de dicas',
    resumo: 'Da cor até a arte: menos dicas, mais pontos.',
    Icone: ListOrdered,
  },
  {
    id: 'grade',
    nome: 'Grade de criaturas',
    resumo: 'Nove casas, uma criatura em cada.',
    Icone: Grid3x3,
  },
  {
    id: 'jogada',
    nome: 'Mais ou menos jogada',
    resumo: 'Qual aparece em mais decks de Commander?',
    Icone: TrendingUp,
  },
  {
    id: 'preco',
    nome: 'Mais barata ou mais cara',
    resumo: 'Qual vale mais em dólar?',
    Icone: Coins,
  },
] as const;

type IdDoJogo = (typeof JOGOS)[number]['id'];

export default function DesafiosPage() {
  const t = useT();
  const [jogo, setJogo] = useState<IdDoJogo>('arte');

  return (
    <div className="mx-auto max-w-5xl animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-6">
        <h1 className="text-text mb-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl">
          <Puzzle className="text-primary h-7 w-7 sm:h-8 sm:w-8" />
          {t('Desafios')}
        </h1>
        <p className="text-text-muted text-sm sm:text-base">
          {t(
            'Passatempos com as cartas mais jogadas em Commander. O recorde e a sequência seguem a sua conta.',
          )}
        </p>
      </header>

      <div
        className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
        role="tablist"
        aria-label="Desafios"
      >
        {JOGOS.map(({ id, nome, resumo, Icone }) => (
          <button
            key={id}
            role="tab"
            aria-selected={jogo === id}
            onClick={() => setJogo(id)}
            className={`flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
              jogo === id
                ? 'border-primary bg-primary/10'
                : 'border-panel-border bg-panel hover:border-primary/60'
            }`}
          >
            <Icone className={`h-5 w-5 ${jogo === id ? 'text-primary' : 'text-text-muted'}`} />
            <span className="text-text text-sm font-semibold">{nome}</span>
            <span className="text-text-faint text-xs">{resumo}</span>
          </button>
        ))}
      </div>

      {/* `key`: trocar de jogo começa o jogo novo do zero, sem herdar estado. */}
      <section
        key={jogo}
        role="tabpanel"
        className="bg-panel/60 border-panel-border rounded-xl border p-4 sm:p-6"
      >
        {jogo === 'arte' && <Adivinhacao modo="arte" />}
        {jogo === 'escada' && <Adivinhacao modo="escada" />}
        {jogo === 'grade' && <GradeDeCriaturas />}
        {jogo === 'jogada' && <Comparacao regra={MAIS_JOGADA} />}
        {jogo === 'preco' && <Comparacao regra={MAIS_CARA} />}
      </section>
    </div>
  );
}
