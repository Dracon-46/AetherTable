'use client';

/**
 * catalog.ts — identidade das cartas no cliente.
 *
 * ─── POR QUE ISTO PRECISAVA EXISTIR ────────────────────────────────────────
 *
 * A mesa inteira era feita de IMAGENS e nada mais. O `Card` do servidor carrega
 * um `scryfallId` e mais nada — é o princípio central do modelo de dados
 * (DOC-030 §1.2: "não guardamos texto, regras nem imagem de carta"). O
 * frontend, porém, nunca fez a outra metade do trato: nunca hidratou nada.
 *
 * O resultado era um sandbox onde ninguém sabia o nome de nada. O log dizia
 * "moveu uma carta" mesmo entre duas zonas públicas, onde nomear é permitido e
 * esperado. Não havia busca por nome na mesa, não havia P/T impresso, e uma
 * carta de dupla face não tinha como saber que tinha um verso.
 *
 * ─── COMO FUNCIONA ─────────────────────────────────────────────────────────
 *
 * Um pedido de metadados não vira uma requisição. Ids pedidos entram numa fila,
 * a fila é drenada em lotes de 75 (`POST /cards/collection`, o teto do
 * endpoint) com no máximo uma requisição em voo — a Scryfall pede ~10 req/s e
 * um User-Agent identificável, e ser bloqueado significa uma mesa inteira sem
 * cartas.
 *
 * O cache é persistido em `localStorage`: metadados de carta são imutáveis por
 * impressão, então recarregar a página não deve custar 300 requisições.
 *
 * ─── LIMITE DE PRIVACIDADE ─────────────────────────────────────────────────
 *
 * Só é possível pedir metadado de carta cujo `scryfallId` o servidor decidiu
 * enviar. Cartas em zona oculta não têm id no cliente — não existem aqui nem
 * como chave. A hidratação não abre nenhum caminho lateral para RN02.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

export interface FaceMeta {
  name: string;
  typeLine: string;
  manaCost: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  imageSmall?: string;
  imageNormal?: string;
}

export interface CardMeta {
  scryfallId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  oracleText: string;
  cmc: number;
  colorIdentity: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  layout: string;
  /** Tem verso jogável (transform / modal_dfc / meld). */
  temVerso: boolean;
  faces: FaceMeta[];
  setCode: string;
  collectorNumber: string;
}

const CHAVE_CACHE = 'aether-card-catalog-v1';
/** Teto do `POST /cards/collection`. */
const LOTE = 75;
/** Acima disto o localStorage vira um problema; descartamos os mais antigos. */
const MAX_PERSISTIDO = 4000;
/** Janela de agrupamento: um turno de render pede dezenas de ids de uma vez. */
const DEBOUNCE_MS = 120;

interface CatalogState {
  cartas: Record<string, CardMeta>;
  /** Ids que a Scryfall não reconheceu — não adianta pedir de novo. */
  ausentes: Record<string, true>;
  carregando: boolean;
  hidratar: (ids: Array<string | undefined | null>) => void;
}

// ─── Fila de hidratação ──────────────────────────────────────────────────────

const pendentes = new Set<string>();
const emVoo = new Set<string>();
let agendado: ReturnType<typeof setTimeout> | null = null;
let drenando = false;

interface RespostaScryfall {
  data?: Array<Record<string, unknown>>;
  not_found?: Array<{ id?: string }>;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizarFace(face: Record<string, unknown>): FaceMeta {
  const imgs = (face.image_uris ?? {}) as Record<string, string>;
  return {
    name: texto(face.name),
    typeLine: texto(face.type_line),
    manaCost: texto(face.mana_cost),
    oracleText: texto(face.oracle_text),
    power: typeof face.power === 'string' ? face.power : undefined,
    toughness: typeof face.toughness === 'string' ? face.toughness : undefined,
    loyalty: typeof face.loyalty === 'string' ? face.loyalty : undefined,
    imageSmall: imgs.small,
    imageNormal: imgs.normal,
  };
}

/** Layouts em que o verso é uma face JOGÁVEL, não só arte diferente. */
const LAYOUTS_COM_VERSO = new Set([
  'transform',
  'modal_dfc',
  'double_faced_token',
  'reversible_card',
  'meld',
]);

function normalizar(bruto: Record<string, unknown>): CardMeta {
  const facesBrutas = Array.isArray(bruto.card_faces)
    ? (bruto.card_faces as Array<Record<string, unknown>>)
    : [];
  const imgs = (bruto.image_uris ?? {}) as Record<string, string>;
  const layout = texto(bruto.layout);

  const faces: FaceMeta[] = facesBrutas.length
    ? facesBrutas.map(normalizarFace)
    : [
        {
          name: texto(bruto.name),
          typeLine: texto(bruto.type_line),
          manaCost: texto(bruto.mana_cost),
          oracleText: texto(bruto.oracle_text),
          power: typeof bruto.power === 'string' ? bruto.power : undefined,
          toughness: typeof bruto.toughness === 'string' ? bruto.toughness : undefined,
          loyalty: typeof bruto.loyalty === 'string' ? bruto.loyalty : undefined,
          imageSmall: imgs.small,
          imageNormal: imgs.normal,
        },
      ];

  const frente = faces[0]!;

  return {
    scryfallId: texto(bruto.id),
    name: texto(bruto.name) || frente.name,
    typeLine: texto(bruto.type_line) || frente.typeLine,
    manaCost: texto(bruto.mana_cost) || frente.manaCost,
    oracleText: texto(bruto.oracle_text) || frente.oracleText,
    cmc: typeof bruto.cmc === 'number' ? bruto.cmc : 0,
    colorIdentity: Array.isArray(bruto.color_identity) ? (bruto.color_identity as string[]) : [],
    power: frente.power,
    toughness: frente.toughness,
    loyalty: frente.loyalty,
    layout,
    // `card_faces` sozinho não basta: split, adventure e flip TAMBÉM têm duas
    // faces, mas uma imagem só. Virar essas cartas mostraria um 404.
    temVerso: LAYOUTS_COM_VERSO.has(layout) && faces.length > 1,
    faces,
    setCode: texto(bruto.set),
    collectorNumber: texto(bruto.collector_number),
  };
}

function lerCache(): Record<string, CardMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const cru = window.localStorage.getItem(CHAVE_CACHE);
    return cru ? (JSON.parse(cru) as Record<string, CardMeta>) : {};
  } catch {
    // localStorage indisponível (aba privada, cota estourada): seguimos só com
    // o cache em memória. Nunca deixar isto derrubar a mesa.
    return {};
  }
}

function gravarCache(cartas: Record<string, CardMeta>): void {
  if (typeof window === 'undefined') return;
  try {
    const chaves = Object.keys(cartas);
    const recorte =
      chaves.length <= MAX_PERSISTIDO
        ? cartas
        : Object.fromEntries(
            chaves.slice(chaves.length - MAX_PERSISTIDO).map((k) => [k, cartas[k]!]),
          );
    window.localStorage.setItem(CHAVE_CACHE, JSON.stringify(recorte));
  } catch {
    /* cota cheia: o cache em memória continua valendo nesta sessão */
  }
}

export const useCardCatalog = create<CatalogState>((set, get) => ({
  cartas: lerCache(),
  ausentes: {},
  carregando: false,

  hidratar: (ids) => {
    const { cartas, ausentes } = get();
    let novos = 0;
    for (const id of ids) {
      if (!id) continue;
      if (cartas[id] || ausentes[id] || pendentes.has(id) || emVoo.has(id)) continue;
      pendentes.add(id);
      novos += 1;
    }
    if (novos === 0) return;

    if (agendado) clearTimeout(agendado);
    agendado = setTimeout(() => {
      agendado = null;
      void drenar(set, get);
    }, DEBOUNCE_MS);
  },
}));

async function drenar(
  set: (parcial: Partial<CatalogState>) => void,
  get: () => CatalogState,
): Promise<void> {
  if (drenando) return;
  drenando = true;
  set({ carregando: true });

  try {
    while (pendentes.size > 0) {
      const lote = [...pendentes].slice(0, LOTE);
      lote.forEach((id) => {
        pendentes.delete(id);
        emVoo.add(id);
      });

      try {
        const res = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: lote.map((id) => ({ id })) }),
        });

        if (!res.ok) throw new Error(`Scryfall respondeu ${res.status}`);

        const corpo = (await res.json()) as RespostaScryfall;
        const encontradas: Record<string, CardMeta> = {};
        for (const bruto of corpo.data ?? []) {
          const meta = normalizar(bruto);
          if (meta.scryfallId) encontradas[meta.scryfallId] = meta;
        }

        // Ids que a Scryfall não conhece entram numa denylist: sem isso, cada
        // render pediria de novo, para sempre.
        const naoAchados: Record<string, true> = {};
        for (const nf of corpo.not_found ?? []) if (nf.id) naoAchados[nf.id] = true;
        for (const id of lote) {
          if (!encontradas[id] && !naoAchados[id]) naoAchados[id] = true;
        }

        const cartas = { ...get().cartas, ...encontradas };
        set({ cartas, ausentes: { ...get().ausentes, ...naoAchados } });
        gravarCache(cartas);
      } catch (erro) {
        // Falha de rede não pode virar loop: os ids voltam para a fila UMA vez
        // e a drenagem para. O próximo `hidratar` tenta de novo.
        console.warn('[catalog] Falha ao hidratar cartas:', erro);
        lote.forEach((id) => emVoo.delete(id));
        break;
      } finally {
        lote.forEach((id) => emVoo.delete(id));
      }
    }
  } finally {
    drenando = false;
    set({ carregando: false });
  }
}

// ─── API de consumo ──────────────────────────────────────────────────────────

/**
 * Metadado de uma carta. Dispara a hidratação se ainda não houver.
 *
 * A hidratação vai num `useEffect`, não no corpo do render: disparar efeito
 * durante o render é justamente o que o React 19 em modo estrito duplica, e o
 * resultado seria uma requisição a mais por carta a cada montagem.
 */
export function useCardMeta(scryfallId?: string | null): CardMeta | null {
  const meta = useCardCatalog((s) => (scryfallId ? (s.cartas[scryfallId] ?? null) : null));
  const hidratar = useCardCatalog((s) => s.hidratar);

  useEffect(() => {
    if (scryfallId) hidratar([scryfallId]);
  }, [scryfallId, hidratar]);

  return meta;
}

/** Hidrata um conjunto de ids. Seguro para chamar a cada render. */
export function useHidratarCartas(ids: Array<string | undefined | null>): void {
  const hidratar = useCardCatalog((s) => s.hidratar);
  // A chave estável evita reexecutar quando só a ordem do array muda.
  const chave = ids.filter(Boolean).sort().join(',');

  useEffect(() => {
    if (chave) hidratar(chave.split(','));
  }, [chave, hidratar]);
}

/** Nome exibível, com recuo honesto quando ainda não chegou. */
export function nomeDaCarta(meta: CardMeta | null | undefined, faceIndex = 0): string {
  if (!meta) return 'Carta';
  return meta.faces[faceIndex]?.name ?? meta.name;
}

/** P/T impresso da face visível — só para criaturas. */
export function ptImpresso(meta: CardMeta | null, faceIndex = 0): string | null {
  const face = meta?.faces[faceIndex];
  if (!face?.power || !face?.toughness) return null;
  return `${face.power}/${face.toughness}`;
}
