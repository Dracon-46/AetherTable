/**
 * sugestoes.service.ts — cartas recomendadas para um deck, a partir do
 * comandante dele.
 *
 * O mesmo raciocínio do deck aleatório (ver `temas.ts`), virado ao contrário:
 * em vez de montar um deck inteiro em volta do comandante, mostra o que falta
 * a um deck que já existe. Cada papel é UMA busca da Scryfall na identidade do
 * comandante, ordenada pelo EDHREC — "o que mais se joga com essas cores" — e
 * o que já está no deck sai da lista.
 *
 * Sem comandante não há sugestão: o tema e a identidade de cor vêm dele, e um
 * deck de Modern sem comandante não tem de onde tirar nenhum dos dois.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { ScryfallCard } from '@aethertable/scryfall-client';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CardsService } from '../../cards/cards.service.js';
import { temasDoComandante, type Tema } from './temas.js';
import type { Candidata } from './montagem.js';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/** Quantas cartas cada papel mostra. Mais que isso é rolagem, não sugestão. */
export const POR_PAPEL = 12;

export interface CartaSugerida {
  scryfallId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  /** Avisa: pôr a carta no deck pode subir o bracket. */
  gameChanger: boolean;
}

export interface GrupoDeSugestoes {
  papel: 'tema' | 'ramp' | 'compra' | 'remocao' | 'terrenos';
  nome: string;
  cartas: CartaSugerida[];
}

/**
 * As primeiras `max` candidatas que o deck ainda não tem. Pura: a "carta" é o
 * `oracle_id` (ou o nome, se faltar), para outra impressão da mesma carta não
 * aparecer como novidade.
 */
export function filtrarSugestoes(
  candidatas: Candidata[],
  jaNoDeck: ReadonlySet<string>,
  max = POR_PAPEL,
): CartaSugerida[] {
  const vistas = new Set(jaNoDeck);
  const saida: CartaSugerida[] = [];
  for (const c of candidatas) {
    if (saida.length >= max) break;
    const chave = c.oracle_id ?? c.name;
    if (vistas.has(chave) || vistas.has(c.name)) continue;
    vistas.add(chave);
    saida.push({
      scryfallId: c.id,
      name: c.name,
      typeLine: c.type_line ?? c.card_faces?.[0]?.type_line ?? '',
      manaCost: c.mana_cost || (c as unknown as ScryfallCard).card_faces?.[0]?.mana_cost || '',
      gameChanger: Boolean(c.game_changer),
    });
  }
  return saida;
}

@Injectable()
export class SugestoesDeCartasService {
  constructor(
    private prisma: PrismaService,
    private cards: CardsService,
  ) {}

  async sugerir(userId: string, deckId: string) {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, userId },
      select: { cards: { select: { scryfallId: true, boardType: true } } },
    });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const ids = [...new Set(deck.cards.map((c) => c.scryfallId.toLowerCase()))];
    const cartas = ids.length
      ? ((await this.cards.collection(ids.map((id) => ({ id })))).data as Candidata[])
      : [];
    const porId = new Map(cartas.map((c) => [c.id.toLowerCase(), c]));
    const comandantes = deck.cards
      .filter((c) => c.boardType === 'COMMANDER')
      .map((c) => porId.get(c.scryfallId.toLowerCase()))
      .filter((c): c is Candidata => Boolean(c));

    if (comandantes.length === 0) {
      return { comandantes: [], temas: [] as string[], grupos: [] as GrupoDeSugestoes[] };
    }

    // Parceiros somam identidade e tema.
    const cores = WUBRG.filter((c) => comandantes.some((k) => k.color_identity?.includes(c)));
    const identidade = cores.length ? `id<=${cores.join('')}` : 'id:c';
    const base = `${identidade} legal:commander game:paper`;
    const producao = cores.length
      ? `(${cores.map((c) => `produces:${c.toLowerCase()}`).join(' or ')})`
      : 'produces:c';
    const temas: Tema[] = [];
    for (const k of comandantes) {
      for (const t of temasDoComandante(k)) {
        if (!temas.some((x) => x.consulta === t.consulta)) temas.push(t);
      }
    }
    const tema = temas.length ? `(${temas.map((t) => `(${t.consulta})`).join(' or ')})` : null;

    const jaNoDeck = new Set(cartas.flatMap((c) => [c.oracle_id ?? c.name, c.name]));

    const papeis: { papel: GrupoDeSugestoes['papel']; nome: string; consulta: string }[] = [
      ...(tema
        ? [{ papel: 'tema' as const, nome: 'Do tema', consulta: `${tema} -t:land ${base}` }]
        : []),
      { papel: 'ramp', nome: 'Aceleração de mana', consulta: `otag:ramp -t:land ${base}` },
      { papel: 'compra', nome: 'Compra de cartas', consulta: `otag:draw -t:land ${base}` },
      { papel: 'remocao', nome: 'Remoção', consulta: `otag:removal -t:land ${base}` },
      { papel: 'terrenos', nome: 'Terrenos', consulta: `t:land -t:basic ${producao} ${base}` },
    ];

    const grupos = await Promise.all(
      papeis.map(async (p) => ({
        papel: p.papel,
        nome: p.nome,
        cartas: filtrarSugestoes(await this.buscar(p.consulta), jaNoDeck),
      })),
    );

    return {
      comandantes: comandantes.map((c) => c.name),
      temas: temas.map((t) => t.nome),
      grupos: grupos.filter((g) => g.cartas.length > 0),
    };
  }

  /** Mesma regra do gerador: busca sem resultado (404 da Scryfall) é lista vazia. */
  private async buscar(consulta: string): Promise<Candidata[]> {
    try {
      const resposta = (await this.cards.search(consulta, 'cards', 1, 'edhrec')) as {
        data?: Candidata[];
      };
      return resposta.data ?? [];
    } catch (erro) {
      if (erro instanceof NotFoundException) return [];
      throw erro;
    }
  }
}
