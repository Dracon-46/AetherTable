/**
 * Seed de desenvolvimento.
 *
 * Cria os 4 jogadores de teste que o guia de setup descreve
 * (docs/guia_de_configuracao_e_desenvolvimento.md §4, passo 4), com dois decks
 * de Commander cada — o suficiente para abrir uma mesa de 4 sozinho, em quatro
 * abas ou perfis de navegador.
 *
 *   jogador1@teste.com … jogador4@teste.com   senha: teste1234
 *
 * APENAS dev/staging. Nunca rodar em produção.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE O SEED VAI À REDE
 *
 * Os `scryfallId` são resolvidos POR NOME na Scryfall, em vez de virem escritos
 * à mão. Um id inventado passa por toda a validação — é só um VarChar(36) — e o
 * sintoma só aparece na mesa: o frontend pede uma carta que não existe e
 * renderiza o verso. Isso é indistinguível de um bug de visibilidade (RN02) e
 * custa horas de investigação no lugar errado.
 *
 * A resolução passa pelo `@aethertable/scryfall-client`, que serializa as
 * chamadas com o intervalo de 100 ms e manda o User-Agent obrigatório
 * (DOC-035 §3). De quebra, o resultado popula o `card_cache`.
 *
 * Sem rede, o seed FALHA em vez de gravar dado falso.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient, BoardType } from '@prisma/client';
import * as argon2 from 'argon2';
import { ScryfallClient, imageUrl } from '@aethertable/scryfall-client';

const prisma = new PrismaClient();

const SENHA_DE_TESTE = 'teste1234';

/** Um comandante por jogador. Resolvidos por nome exato. */
const COMANDANTES = [
  'Atraxa, Praetors\' Voice',
  'Krenko, Mob Boss',
  'Yuriko, the Tiger\'s Shadow',
  'Omnath, Locus of Creation',
];

/**
 * Cartas de preenchimento do grimório. Poucos nomes distintos, repetidos via
 * `quantity`: o objetivo é ter 99 cartas jogáveis e renderizáveis, não um deck
 * legal para torneio.
 */
const PREENCHIMENTO = [
  'Sol Ring',
  'Arcane Signet',
  'Command Tower',
  'Swiftfoot Boots',
  'Cultivate',
];

interface CartaResolvida {
  scryfallId: string;
  nome: string;
  coresIdentidade: string[];
}

/** Resolve todos os nomes de uma vez e grava o resultado no card_cache. */
async function resolverCartas(): Promise<Map<string, CartaResolvida>> {
  const userAgent =
    process.env.SCRYFALL_USER_AGENT ?? 'AetherTable-seed/1.0 (dev@localhost)';

  const scryfall = new ScryfallClient({ userAgent });
  const nomes = [...COMANDANTES, ...PREENCHIMENTO];

  console.log(`Resolvendo ${nomes.length} cartas na Scryfall...`);

  const resposta = await scryfall.collection(nomes.map((name) => ({ name })));

  if (resposta.not_found.length > 0) {
    const faltando = resposta.not_found.map((i) => i.name ?? '?').join(', ');
    throw new Error(
      `A Scryfall não encontrou: ${faltando}. Corrija os nomes em prisma/seed.ts.`,
    );
  }

  const porNome = new Map<string, CartaResolvida>();

  for (const carta of resposta.data) {
    porNome.set(carta.name.toLowerCase(), {
      scryfallId: carta.id,
      nome: carta.name,
      coresIdentidade: carta.color_identity ?? [],
    });

    // Popula o cache. É tabela descartável (DOC-023 §3.5), mas tê-la quente
    // evita a primeira mesa disparar dezenas de requisições.
    await prisma.cardCache.upsert({
      where: { scryfallId: carta.id },
      update: {},
      create: {
        scryfallId: carta.id,
        oracleId: carta.oracle_id ?? '',
        name: carta.name,
        setCode: carta.set,
        collectorNum: carta.collector_number,
        lang: carta.lang,
        cmc: carta.cmc ?? 0,
        typeLine: carta.type_line ?? '',
        manaCost: carta.mana_cost ?? '',
        colorIdentity: carta.color_identity ?? [],
        legalCommander: carta.legalities?.commander === 'legal',
        layout: carta.layout,
        imageSmall: imageUrl(carta, 'small') ?? '',
        imageNormal: imageUrl(carta, 'normal') ?? '',
        faces: (carta.card_faces ?? []) as object,
      },
    });
  }

  return porNome;
}

function exigir(mapa: Map<string, CartaResolvida>, nome: string): CartaResolvida {
  const carta = mapa.get(nome.toLowerCase());
  if (!carta) {
    throw new Error(`Carta "${nome}" não voltou da Scryfall.`);
  }
  return carta;
}

async function criarDeck(
  userId: string,
  nome: string,
  comandante: CartaResolvida,
  preenchimento: CartaResolvida[],
): Promise<void> {
  // 99 no main + 1 comandante = 100.
  const porCarta = Math.floor(99 / preenchimento.length);
  const sobra = 99 - porCarta * preenchimento.length;

  const cartas = preenchimento.map((c, i) => ({
    scryfallId: c.scryfallId,
    quantity: porCarta + (i === 0 ? sobra : 0),
    isCommander: false,
    boardType: BoardType.MAIN,
    sortOrder: i,
  }));

  const total = cartas.reduce((soma, c) => soma + c.quantity, 0) + 1;

  // Deck e cartas nascem na MESMA operação, e `cardCount` é gravado junto —
  // a desnormalização só é segura se atualizada na mesma transação (DOC-023 §3.3).
  await prisma.deck.create({
    data: {
      userId,
      name: nome,
      formatId: 'commander',
      commanderId: comandante.scryfallId,
      colorIdentity: comandante.coresIdentidade,
      cardCount: total,
      cards: {
        create: [
          {
            scryfallId: comandante.scryfallId,
            quantity: 1,
            isCommander: true,
            boardType: BoardType.COMMANDER,
            sortOrder: 0,
          },
          ...cartas,
        ],
      },
    },
  });
}

async function main(): Promise<void> {
  console.log('Semeando banco de desenvolvimento...\n');

  const cartas = await resolverCartas();
  const preenchimento = PREENCHIMENTO.map((n) => exigir(cartas, n));

  const passwordHash = await argon2.hash(SENHA_DE_TESTE, { type: argon2.argon2id });

  for (let i = 1; i <= 4; i += 1) {
    const email = `jogador${i}@teste.com`;

    // Idempotente: rodar o seed duas vezes não pode explodir.
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        username: `jogador${i}`,
        displayName: `Jogador ${i}`,
        passwordHash,
      },
    });

    const jaTem = await prisma.deck.count({ where: { userId: user.id } });
    if (jaTem > 0) {
      console.log(`  ${email}: já tinha ${jaTem} deck(s), pulando`);
      continue;
    }

    const comandante = exigir(cartas, COMANDANTES[i - 1]!);
    await criarDeck(user.id, `${comandante.nome} — principal`, comandante, preenchimento);
    await criarDeck(user.id, `${comandante.nome} — alternativo`, comandante, preenchimento);

    console.log(`  ${email} criado — comandante: ${comandante.nome}`);
  }

  console.log(`\nPronto. Entre com qualquer jogadorN@teste.com / ${SENHA_DE_TESTE}`);
}

main()
  .catch((erro) => {
    console.error('\nSeed falhou:', erro instanceof Error ? erro.message : erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
