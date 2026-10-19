'use client';

/**
 * GradeDeCriaturas.tsx — nove casas, uma criatura em cada.
 *
 * As linhas são cores e as colunas são outra coisa (voar, lendária, custo,
 * tipo…). Cada casa pede uma criatura que atenda às duas. Uma carta vale uma
 * vez só, e são doze palpites para as nove casas.
 *
 * A grade só é servida se TODAS as casas têm resposta: cada cruzamento é uma
 * busca na Scryfall antes de a grade aparecer. Sem isso, uma "Branca × Dragão
 * × Toque mortífero" sem nenhuma carta no mundo faria a pessoa procurar o que
 * não existe.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { mensagemDaApi } from '../lib/fetcher';
import { CampoDeNome, Placar } from './comum';
import { useProgressoDeDesafio } from './progresso';
import {
  atendeCasa,
  BASE_DA_GRADE,
  buscar,
  COLUNAS,
  LINHAS,
  normalizarNome,
  sortearVarios,
  type CartaDoDesafio,
  type Criterio,
} from './cartas';

const PALPITES = 12;
const TENTATIVAS_DE_MONTAR = 4;

interface Grade {
  linhas: Criterio[];
  colunas: Criterio[];
}

/** Sorteia uma grade cujas nove casas têm ao menos uma criatura. */
async function montarGrade(): Promise<Grade> {
  for (let i = 0; i < TENTATIVAS_DE_MONTAR; i++) {
    const linhas = sortearVarios(LINHAS, 3);
    const colunas = sortearVarios(COLUNAS, 3);
    let todasTemResposta = true;
    // Em sequência, não em paralelo: nove buscas de uma vez encostariam no
    // limite da rota de busca junto com o autocompletar.
    for (const l of linhas) {
      for (const c of colunas) {
        const achadas = await buscar(`${BASE_DA_GRADE} ${l.consulta} ${c.consulta}`);
        if (achadas.length === 0) {
          todasTemResposta = false;
          break;
        }
      }
      if (!todasTemResposta) break;
    }
    if (todasTemResposta) return { linhas, colunas };
  }
  throw new Error('Não consegui montar uma grade com resposta em todas as casas. Tente de novo.');
}

export function GradeDeCriaturas() {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [casas, setCasas] = useState<Record<string, CartaDoDesafio>>({});
  const [casaAtiva, setCasaAtiva] = useState<string | null>(null);
  const [palpites, setPalpites] = useState(PALPITES);
  const [aviso, setAviso] = useState<{ texto: string; bom: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  /**
   * Só o RECORDE segue a conta aqui. A grade sorteada não é guardada — são
   * nove critérios e as cartas de cada casa, não um número —, então um F5
   * começa outra grade de qualquer jeito, e não há pergunta para pular. A
   * "sequência" gravada é a contagem de casas da grade em curso.
   */
  const { recorde, pronto, responder } = useProgressoDeDesafio('grade');

  const nova = useCallback(async () => {
    setGrade(null);
    setCasas({});
    setCasaAtiva(null);
    setPalpites(PALPITES);
    setAviso(null);
    setErro(null);
    try {
      setGrade(await montarGrade());
    } catch (e) {
      setErro(mensagemDaApi(e));
    }
  }, []);

  useEffect(() => {
    void nova();
  }, [nova]);

  const preenchidas = Object.keys(casas).length;
  const acabou = preenchidas === 9 || palpites === 0;

  const chutar = async (nome: string) => {
    if (!grade || !casaAtiva || acabou) return;
    const [li, ci] = casaAtiva.split(':').map(Number);
    const linha = grade.linhas[li!]!;
    const coluna = grade.colunas[ci!]!;
    setConferindo(true);
    try {
      const [carta] = await buscar(`!"${nome.replace(/"/g, '')}"`);
      if (!carta) {
        setAviso({ texto: `Não achei nenhuma carta chamada "${nome}".`, bom: false });
        return;
      }
      const usada = Object.values(casas).some(
        (c) => normalizarNome(c.name) === normalizarNome(carta.name),
      );
      if (usada) {
        setAviso({
          texto: `${carta.name} já está na grade — cada carta vale uma vez.`,
          bom: false,
        });
        return;
      }
      const restantes = palpites - 1;
      setPalpites(restantes);
      if (!atendeCasa(carta, linha, coluna)) {
        setAviso({
          texto: `${carta.name} não é uma criatura ${linha.rotulo.toLowerCase()} com "${coluna.rotulo}".`,
          bom: false,
        });
        return;
      }
      const novas = { ...casas, [casaAtiva]: carta };
      setCasas(novas);
      setCasaAtiva(null);
      setAviso({ texto: `${carta.name} — vale!`, bom: true });
      responder(Object.keys(novas).length);
    } catch (e) {
      setAviso({ texto: mensagemDaApi(e), bom: false });
    } finally {
      setConferindo(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text text-lg font-bold">
          Uma criatura em cada casa. {palpites} palpite(s) restantes.
        </p>
        <Placar pontos={preenchidas} recorde={recorde} rotulo="Casas" />
      </div>

      {erro ? (
        <p className="text-danger text-sm">{erro}</p>
      ) : !grade || !pronto ? (
        <p className="text-text-muted flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando uma grade com resposta em todas as
          casas…
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="grid grid-cols-[5.5rem_repeat(3,minmax(0,1fr))] gap-1.5 text-xs">
            <span />
            {grade.colunas.map((c) => (
              <span key={c.id} className="text-text-muted self-end p-1 text-center font-semibold">
                {c.rotulo}
              </span>
            ))}
            {grade.linhas.map((l, li) => (
              <div key={l.id} className="contents">
                <span className="text-text-muted self-center pr-1 text-right font-semibold">
                  {l.rotulo}
                </span>
                {grade.colunas.map((c, ci) => {
                  const chave = `${li}:${ci}`;
                  const carta = casas[chave];
                  const ativa = casaAtiva === chave;
                  return (
                    <button
                      key={chave}
                      onClick={() => !carta && !acabou && setCasaAtiva(chave)}
                      disabled={Boolean(carta) || acabou}
                      aria-label={
                        carta
                          ? `${l.rotulo} × ${c.rotulo}: ${carta.name}`
                          : `Casa ${l.rotulo} × ${c.rotulo}`
                      }
                      aria-pressed={ativa}
                      className={`bg-panel relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
                        ativa
                          ? 'border-primary'
                          : carta
                            ? 'border-success'
                            : 'border-panel-border hover:border-primary/60'
                      }`}
                    >
                      {carta && (
                        <>
                          <img
                            src={cardImageUrl(carta.id, 'art_crop')}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                          <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[10px] text-white">
                            {carta.name}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {acabou ? (
              <>
                <p
                  className={`font-semibold ${preenchidas === 9 ? 'text-success' : 'text-warning'}`}
                >
                  {preenchidas === 9
                    ? 'Grade completa!'
                    : `Os palpites acabaram: ${preenchidas} de 9 casas.`}
                </p>
                <button
                  onClick={() => void nova()}
                  className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white"
                >
                  <RotateCcw className="h-4 w-4" /> Outra grade
                </button>
              </>
            ) : casaAtiva ? (
              <>
                <p className="text-text-muted text-sm">
                  Uma criatura{' '}
                  <strong className="text-text">
                    {grade.linhas[Number(casaAtiva.split(':')[0])]!.rotulo.toLowerCase()}
                  </strong>{' '}
                  com{' '}
                  <strong className="text-text">
                    {grade.colunas[Number(casaAtiva.split(':')[1])]!.rotulo}
                  </strong>
                  :
                </p>
                <CampoDeNome onPalpite={(n) => void chutar(n)} desabilitado={conferindo} />
              </>
            ) : (
              <p className="text-text-muted text-sm">Escolha uma casa vazia.</p>
            )}
            {aviso && (
              <p className={`text-sm ${aviso.bom ? 'text-success' : 'text-danger'}`}>
                {aviso.texto}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
