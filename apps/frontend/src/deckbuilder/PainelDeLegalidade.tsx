'use client';

/**
 * PainelDeLegalidade.tsx — o que falta para este deck ser legal.
 *
 * ─── O QUE ESTAVA NO LUGAR DISTO ───────────────────────────────────────────
 *
 * Dois `if` escritos à mão no corpo da página do deck:
 *
 *     {deck.cardCount !== 100 && deck.cardCount > 0 && (
 *       <div>Seu deck possui {deck.cardCount} cartas. O formato Commander
 *            exige exatas 100.</div>
 *     )}
 *     {deck.cards?.some((c) => c.isBanned) && (<div>… cartas Banidas …</div>)}
 *
 * O primeiro é o bug que o usuário relatou: ele não consultava formato nenhum,
 * então aparecia em deck de Modern — onde a regra é "mínimo 60" e 100 cartas
 * está perfeitamente legal — afirmando que o formato era Commander. E o texto
 * dizia "Commander" fixo, mesmo num deck de Pauper.
 *
 * O segundo era a ÚNICA outra regra do jogo que a tela conhecia. Não havia
 * limite de cópias, singleton, identidade de cor, restritas, teto de raridade
 * nem teto de reserva — as regras que de fato definem um deck de Magic.
 *
 * Agora a avaliação vem de `avaliarLegalidade` (@aethertable/shared-types), a
 * MESMA função que o servidor usa para decidir se o deck entra na mesa. Uma
 * fonte só: o painel não pode dizer "está tudo certo" sobre um deck que o
 * `join` vai recusar.
 *
 * ─── E POR QUE ELE MOSTRA A REGRA DO FORMATO, E NÃO SÓ OS PROBLEMAS ────────
 *
 * Um deck vazio de Pauper não tem achado nenhum, e isso não informa nada. O
 * cabeçalho diz o que o formato exige — tamanho, cópias, reserva, teto de
 * raridade — para quem está começando a montar saber o alvo antes de errá-lo.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ScrollText,
  ShieldAlert,
} from 'lucide-react';
import { avaliarLegalidade, descreverTamanho, type Achado } from '@aethertable/shared-types';
import type { DeckCarta } from './useDecks';

/** Símbolo de cada cor, para o selo de identidade. */
const COR = {
  W: { rotulo: 'W', classe: 'bg-mana-w text-black' },
  U: { rotulo: 'U', classe: 'bg-mana-u text-black' },
  B: { rotulo: 'B', classe: 'bg-mana-b text-black' },
  R: { rotulo: 'R', classe: 'bg-mana-r text-black' },
  G: { rotulo: 'G', classe: 'bg-mana-g text-black' },
} as const;

function Linha({ achado }: { achado: Achado }) {
  const erro = achado.gravidade === 'erro';
  return (
    <li
      className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${
        erro
          ? 'border-danger/30 bg-danger/10 text-danger'
          : 'border-warning/30 bg-warning/10 text-warning'
      }`}
    >
      {erro ? (
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        {achado.mensagem}
        {/* O rótulo de bloqueio só aparece nos erros: marcar todo aviso com um
            selo faria os dois parecerem a mesma coisa, e a diferença entre
            "não vou conseguir jogar" e "confira isso" é o ponto do painel. */}
        {erro && (
          <span className="bg-danger/20 ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
            impede a mesa
          </span>
        )}
      </span>
    </li>
  );
}

export function PainelDeLegalidade({
  cartas,
  formatId,
  cardCount,
}: {
  cartas: DeckCarta[];
  formatId: string;
  /** O contador desnormalizado, para o painel poder acusar divergência. */
  cardCount?: number;
}) {
  const [aberto, setAberto] = useState(true);

  const legal = useMemo(
    () => avaliarLegalidade({ formatId, cardCount, cards: cartas }),
    [formatId, cardCount, cartas],
  );

  const { formato } = legal;
  const erros = legal.achados.filter((a) => a.gravidade === 'erro');
  const avisos = legal.achados.filter((a) => a.gravidade === 'aviso');
  const vazio = cartas.length === 0;

  /** Uma frase com as regras do formato. É o "alvo" de quem está montando. */
  const regras = useMemo(() => {
    const d = formato.deck;
    const partes = [descreverTamanho(d)];
    if (d.singleton) partes.push('singleton (uma cópia de cada, terrenos básicos à parte)');
    else partes.push(`até ${d.maxCopias} cópias de cada`);
    if (d.tetoDeRaridade)
      partes.push(`só ${d.tetoDeRaridade === 'common' ? 'comuns' : 'comuns e incomuns'}`);
    if (d.maxValorDeMana !== null) partes.push(`custo de mana até ${d.maxValorDeMana}`);
    if (d.reserva) partes.push(`reserva de até ${d.reserva.max}`);
    else partes.push('sem reserva');
    if (formato.comandante) {
      partes.push(
        formato.comandante.tipo === 'planeswalker'
          ? 'um planeswalker na zona de comando'
          : 'um comandante lendário',
      );
    }
    return partes.join(' · ');
  }, [formato]);

  return (
    <section className="border-panel-border bg-panel mb-5 overflow-hidden rounded-xl border">
      <button
        onClick={() => setAberto((v) => !v)}
        className="hover:bg-panel-hover flex w-full items-center gap-3 p-4 text-left transition-colors"
        aria-expanded={aberto}
      >
        {vazio ? (
          <ScrollText className="text-text-muted h-5 w-5 shrink-0" />
        ) : erros.length > 0 ? (
          <ShieldAlert className="text-danger h-5 w-5 shrink-0" />
        ) : avisos.length > 0 ? (
          <AlertTriangle className="text-warning h-5 w-5 shrink-0" />
        ) : (
          <BadgeCheck className="text-success h-5 w-5 shrink-0" />
        )}

        <span className="min-w-0 flex-1">
          <span className="text-text flex flex-wrap items-center gap-2 text-sm font-bold">
            Legalidade em {formato.nome}
            {formato.status !== 'ESTAVEL' && (
              <span className="bg-table-deep text-text-muted rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                {formato.status === 'BETA' ? 'beta' : 'planejado'}
              </span>
            )}
            {/* A identidade de cor deduzida do comandante. É a informação que
                mais falta ao montar um deck de Commander, e ela não existia em
                nenhum lugar da interface. */}
            {legal.identidadeDeCor.length > 0 && (
              <span className="flex items-center gap-1">
                {legal.identidadeDeCor.map((c) => (
                  <span
                    key={c}
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                      COR[c as keyof typeof COR]?.classe ?? 'bg-panel-border'
                    }`}
                    title={`Identidade de cor: ${c}`}
                  >
                    {COR[c as keyof typeof COR]?.rotulo ?? c}
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="text-text-muted mt-0.5 block text-xs">
            {vazio
              ? regras
              : erros.length > 0
                ? `${erros.length} problema(s) impedem a entrada na mesa${avisos.length ? ` · ${avisos.length} aviso(s)` : ''}`
                : avisos.length > 0
                  ? `${avisos.length} aviso(s) — o deck entra na mesa`
                  : 'Nenhum problema encontrado.'}
          </span>
        </span>

        <span className="text-text-faint shrink-0 font-mono text-xs">
          {legal.total}
          {formato.deck.exato !== null && `/${formato.deck.exato}`}
          {legal.totalReserva > 0 && ` +${legal.totalReserva}`}
        </span>
        <ChevronDown
          className={`text-text-muted h-4 w-4 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`}
        />
      </button>

      {aberto && (
        <div className="border-panel-border border-t p-4">
          <p className="text-text-faint mb-3 text-xs leading-relaxed">
            <span className="text-text-muted font-semibold">{formato.nome}:</span> {regras}.
          </p>

          {legal.achados.length === 0 ? (
            <p className="text-success flex items-center gap-2 text-sm">
              <BadgeCheck className="h-4 w-4 shrink-0" />
              {vazio
                ? 'Comece a adicionar cartas — os avisos aparecem aqui conforme você monta.'
                : 'Este grimório está legal no formato.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {/* Erros primeiro: é o que impede jogar. */}
              {erros.map((a, i) => (
                <Linha key={`e-${a.codigo}-${i}`} achado={a} />
              ))}
              {avisos.map((a, i) => (
                <Linha key={`a-${a.codigo}-${i}`} achado={a} />
              ))}
            </ul>
          )}

          {/* A nota sobre o sandbox não é rodapé decorativo: sem ela, um deck
              com nove avisos parece reprovado, quando ele entra na mesa
              normalmente (RN01 — o sistema avisa, não impede). */}
          {avisos.length > 0 && erros.length === 0 && (
            <p className="text-text-faint mt-3 flex items-start gap-2 text-xs">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Avisos não impedem nada: a mesa é um sandbox e aceita o deck como ele está. Só os
              itens marcados como <strong>impede a mesa</strong> barram a entrada.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
