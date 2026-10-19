/**
 * gerador-de-deck.service.ts — o deck aleatório: sorteia um comandante e monta
 * o deck em volta dele.
 *
 * Três passos, e só o primeiro e o último falam com o mundo:
 *
 *   1. BUSCAR: o comandante (sorteado entre os ~700 mais jogados do EDHREC) e,
 *      para cada papel do molde, as candidatas da identidade dele — tudo pela
 *      busca da Scryfall, via `CardsService` (cache + fila única: o gerador
 *      não fura o limite de requisições da Scryfall);
 *   2. MONTAR: `montarDeck`, pura — molde, tema e sorteio;
 *   3. GRAVAR: o deck nasce na conta, privado, como qualquer outro.
 *
 * Aleatoriedade por `crypto.randomInt`, não `Math.random`: não é sorteio de
 * mesa (RN06 é do game-server), mas não há motivo para usar o gerador fraco.
 */

import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { ScryfallCard } from '@aethertable/scryfall-client';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { CardsService } from '../../cards/cards.service.js';
import { exigirVagaDeDeck } from '../limites-de-conta.js';
import { temasDoComandante } from './temas.js';
import { descreverDeck, montarDeck, type Basicos, type Candidata } from './montagem.js';

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/**
 * Comandantes sorteáveis. Fora: os que pedem parceiro ("partner", "choose a
 * Background", "Friends forever") — um comandante sozinho que espera um par
 * nasce pela metade.
 */
const COMANDANTES =
  'is:commander legal:commander game:paper -o:partner -o:"choose a background" -o:"friends forever"';

/** Quantas páginas (175 cartas cada) do topo do EDHREC entram no sorteio. */
const PAGINAS_DE_COMANDANTES = 4;

/** Básicos de uma coleção corrente: uma impressão por cor, sempre a mesma. */
const NOME_DO_BASICO: Record<string, keyof Basicos> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
  Wastes: 'C',
};

@Injectable()
export class GeradorDeDeckService {
  constructor(
    private prisma: PrismaService,
    private cards: CardsService,
  ) {}

  async gerar(userId: string) {
    // Antes das ~11 buscas na Scryfall: sem vaga, não vale gastá-las.
    await exigirVagaDeDeck(this.prisma, userId);
    const comandante = await this.sortearComandante();
    const cores = WUBRG.filter((c) => comandante.color_identity?.includes(c));
    // Comandante incolor (Karn, Kozilek…): `id<=` de nada não é sintaxe válida.
    const identidade = cores.length ? `id<=${cores.join('')}` : 'id:c';
    const base = `${identidade} legal:commander game:paper`;
    const producao = cores.length
      ? `(${cores.map((c) => `produces:${c.toLowerCase()}`).join(' or ')})`
      : 'produces:c';

    const temas = temasDoComandante(comandante);
    const tema = temas.length ? `(${temas.map((t) => `(${t.consulta})`).join(' or ')})` : null;

    const [
      terrenosUteis,
      ramp,
      compra,
      remocao,
      limpeza,
      temaCriaturas,
      temaOutras,
      criaturas,
      outras,
      basicos,
    ] = await Promise.all([
      // Só terreno que PRODUZ mana das cores do comandante. Com `id<=` sozinho,
      // fetch lands de identidade incolor entravam em qualquer deck — um mono
      // verde recebia Bloodstained Mire, que busca Pântano ou Montanha.
      this.buscar(`t:land -t:basic ${producao} ${base}`),
      this.buscar(`otag:ramp -t:land ${base}`),
      this.buscar(`otag:draw -t:land ${base}`),
      // Sem as limpezas: elas têm vaga própria, e uma "remoção" que destrói
      // tudo não é a resposta pontual que o papel pede.
      this.buscar(`otag:removal -otag:sweeper -t:land ${base}`),
      this.buscar(`otag:sweeper ${base}`),
      tema ? this.buscar(`${tema} t:creature -t:land ${base}`) : Promise.resolve([]),
      tema ? this.buscar(`${tema} -t:creature -t:land ${base}`) : Promise.resolve([]),
      this.buscar(`t:creature ${base}`),
      this.buscar(`-t:creature -t:land ${base}`),
      this.basicos(),
    ]);

    const montado = montarDeck(
      comandante,
      {
        terrenosUteis,
        ramp,
        compra,
        remocao,
        limpeza,
        temaCriaturas,
        temaOutras,
        criaturas,
        outras,
      },
      basicos,
      (max) => randomInt(max),
    );

    const total = montado.linhas.reduce((s, l) => s + l.quantity, 0);
    // Só acontece se a Scryfall não devolver um básico de alguma cor: melhor
    // recusar que gravar um deck de 92 cartas que a mesa não aceita.
    if (total !== 100) {
      throw new InternalServerErrorException(
        `O deck saiu com ${total} cartas. Tente de novo em instantes.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const novo = await tx.deck.create({
        data: {
          userId,
          name: `Aleatório: ${comandante.name}`.slice(0, 80),
          description: descreverDeck(comandante, temas, montado.contagem),
          formatId: 'commander',
          commanderId: comandante.id,
          colorIdentity: cores,
          cardCount: total,
        },
      });
      await tx.deckCard.createMany({
        data: montado.linhas.map((l) => ({ deckId: novo.id, ...l })),
      });
      return novo;
    });
  }

  /** Uma busca da Scryfall ordenada pelo EDHREC. Zero resultados é lista vazia, não erro. */
  private async buscar(consulta: string, pagina = 1): Promise<Candidata[]> {
    try {
      const resposta = (await this.cards.search(consulta, 'cards', pagina, 'edhrec')) as {
        data?: ScryfallCard[];
      };
      return resposta.data ?? [];
    } catch (erro) {
      // A Scryfall responde 404 a uma busca sem resultado (um tema raro numa
      // cor só, por exemplo). Para o gerador isso é "nenhuma candidata".
      if (erro instanceof NotFoundException) return [];
      throw erro;
    }
  }

  private async sortearComandante(): Promise<Candidata> {
    const pagina = randomInt(1, PAGINAS_DE_COMANDANTES + 1);
    let candidatos = await this.buscar(COMANDANTES, pagina);
    if (candidatos.length === 0) candidatos = await this.buscar(COMANDANTES, 1);
    // Comandante Game Changer (Urza, The Gitrog…) puxaria a mesa para cima.
    candidatos = candidatos.filter((c) => !c.game_changer);
    const escolhido = candidatos[randomInt(Math.max(1, candidatos.length))];
    if (!escolhido) throw new InternalServerErrorException('Nenhum comandante disponível agora.');
    return escolhido;
  }

  private async basicos(): Promise<Basicos> {
    const [cinco, wastes] = await Promise.all([
      this.buscar('t:basic -t:snow set:fdn'),
      this.buscar('!Wastes'),
    ]);
    const basicos: Basicos = {};
    for (const c of [...cinco, ...wastes]) {
      const cor = NOME_DO_BASICO[c.name];
      if (cor && !basicos[cor]) basicos[cor] = c.id;
    }
    return basicos;
  }
}
