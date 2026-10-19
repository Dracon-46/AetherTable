'use client';

/**
 * i18n.ts — a interface em mais de um idioma.
 *
 * ─── O TEXTO EM PORTUGUÊS É A CHAVE ────────────────────────────────────────
 *
 * `t('Meus Grimórios')`, e não `t('nav.decks')`. Três razões:
 *
 *   1. O código continua legível: quem lê o JSX vê o texto que a pessoa vê.
 *   2. Tradução que falta não quebra nada — cai no português, que é o idioma
 *      de origem do produto. Uma chave abstrata sem tradução mostraria
 *      "nav.decks" na tela.
 *   3. A cobertura cresce tela a tela: embrulhar um texto em `t()` é uma
 *      mudança de uma linha, sem inventar nome de chave.
 *
 * O preço é conhecido: mudar o texto em português muda a chave, e a tradução
 * daquele texto precisa mudar junto. O teste de `dicionarios.spec.ts` pega as
 * traduções que ficaram órfãs.
 *
 * Interpolação com `{nome}`: `t('Olá, {nome}', { nome })`.
 */

import { useCallback, useEffect } from 'react';
import type { CodigoDoIdiomaDaInterface } from '@aethertable/shared-types';
import { useAparencia } from '../store/aparencia.store';
import { EN } from './en';

/**
 * O `satisfies` amarra esta lista à do shared-types: o idioma da interface
 * segue a conta, e a API só aceita os códigos de `IDIOMAS_ACEITOS_NA_INTERFACE`.
 * Um idioma novo aqui que não estivesse lá seria salvo e voltaria como o padrão
 * na próxima máquina — agora não compila.
 */
export const IDIOMAS_DA_INTERFACE = [
  { codigo: 'pt-BR', nome: 'Português (Brasil)' },
  { codigo: 'en', nome: 'English' },
] as const satisfies readonly { codigo: CodigoDoIdiomaDaInterface; nome: string }[];
export type IdiomaDaInterface = (typeof IDIOMAS_DA_INTERFACE)[number]['codigo'];

const DICIONARIOS: Record<IdiomaDaInterface, Readonly<Record<string, string>>> = {
  'pt-BR': {},
  en: EN,
};

export function traduzir(
  idioma: string,
  texto: string,
  valores?: Record<string, string | number>,
): string {
  const dicionario = DICIONARIOS[idioma as IdiomaDaInterface] ?? {};
  let saida = dicionario[texto] ?? texto;
  if (valores) {
    for (const [k, v] of Object.entries(valores)) saida = saida.split(`{${k}}`).join(String(v));
  }
  return saida;
}

/** O tradutor do idioma escolhido. Muda junto com a preferência. */
export function useT() {
  const idioma = useAparencia((s) => s.idiomaDaInterface);
  return useCallback(
    (texto: string, valores?: Record<string, string | number>) => traduzir(idioma, texto, valores),
    [idioma],
  );
}

/** Mantém `<html lang>` igual ao idioma escolhido — leitor de tela e corretor dependem dele. */
export function useLangDoDocumento() {
  const idioma = useAparencia((s) => s.idiomaDaInterface);
  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);
}
