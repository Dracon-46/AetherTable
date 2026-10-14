/**
 * temas.ts — o que um comandante "pede", lido do tipo e do texto dele.
 *
 * O deck aleatório não é uma pilha de cartas boas da cor certa: ele é montado
 * EM VOLTA do comandante. Sem motor de regras e sem uma base de sinergia
 * (a do EDHREC não tem API oficial), o tema sai do que a carta diz: um
 * comandante que fala em "+1/+1 counter" quer marcadores; um que fala em
 * "Dinosaur" quer dinossauros. Cada tema vira um trecho de busca da Scryfall.
 *
 * Função pura: recebe a carta, devolve os temas — sem rede, testável.
 */

/** O mínimo da carta que o tema precisa ler. */
export interface CartaComTexto {
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ type_line?: string; oracle_text?: string }>;
}

export interface Tema {
  /** Rótulo em português, para a descrição do deck. */
  nome: string;
  /** Trecho da sintaxe de busca da Scryfall. */
  consulta: string;
}

/**
 * Tribos que valem como tema só por estarem no tipo do comandante — elas têm
 * cartas de sobra que pagam por ter "mais um do mesmo tipo". Tipos genéricos
 * (Human, Avatar, Advisor…) só viram tema se o TEXTO do comandante os citar:
 * todo segundo comandante é Human, e "humanos" não é estratégia.
 */
const TRIBOS = new Set([
  'Angel',
  'Assassin',
  'Beast',
  'Cat',
  'Cleric',
  'Demon',
  'Dinosaur',
  'Dog',
  'Dragon',
  'Elemental',
  'Elf',
  'Faerie',
  'Goblin',
  'Hydra',
  'Knight',
  'Merfolk',
  'Ninja',
  'Pirate',
  'Rat',
  'Rogue',
  'Samurai',
  'Sliver',
  'Soldier',
  'Sphinx',
  'Spirit',
  'Squirrel',
  'Treefolk',
  'Vampire',
  'Warrior',
  'Werewolf',
  'Wizard',
  'Wolf',
  'Zombie',
]);

/** Mecânicas: o que o texto diz → o que buscar. A ordem é a de prioridade. */
const MECANICAS: Array<{ padrao: RegExp; nome: string; consulta: string }> = [
  { padrao: /\+1\/\+1 counter/i, nome: 'marcadores +1/+1', consulta: 'o:"+1/+1 counter"' },
  {
    padrao: /proliferate|counter on/i,
    nome: 'marcadores',
    consulta: '(o:proliferate or o:"counter on")',
  },
  { padrao: /\btokens?\b/i, nome: 'fichas', consulta: '(o:create o:token)' },
  { padrao: /sacrifice/i, nome: 'sacrifício', consulta: '(o:sacrifice or o:"dies")' },
  { padrao: /\bdies\b|leaves the battlefield/i, nome: 'morte de criaturas', consulta: 'o:"dies"' },
  { padrao: /graveyard/i, nome: 'cemitério', consulta: 'o:graveyard' },
  {
    padrao: /landfall|land enters|lands? you control/i,
    nome: 'terrenos',
    consulta: '(o:landfall or (o:land o:enters))',
  },
  { padrao: /artifact/i, nome: 'artefatos', consulta: '(t:artifact or o:artifact)' },
  {
    padrao: /enchantment|aura/i,
    nome: 'encantamentos',
    consulta: '(t:enchantment or o:enchantment)',
  },
  { padrao: /equip/i, nome: 'equipamentos', consulta: '(t:equipment or o:equipped)' },
  {
    padrao: /instant or sorcery|noncreature spell/i,
    nome: 'mágicas',
    consulta: '(t:instant or t:sorcery or o:"noncreature spell")',
  },
  {
    padrao: /gains? (\d+ )?life|lifelink|life total/i,
    nome: 'ganho de vida',
    consulta: '(o:"gain" o:"life" or o:lifelink)',
  },
  { padrao: /\battacks?\b|combat damage/i, nome: 'ataque', consulta: '(o:"whenever" o:"attacks")' },
  { padrao: /\bmill\b/i, nome: 'moer', consulta: 'o:mill' },
  { padrao: /discard/i, nome: 'descarte', consulta: 'o:discard' },
  { padrao: /draws? (a|two|three|your second) cards?/i, nome: 'compra', consulta: 'otag:draw' },
  { padrao: /\bflying\b/i, nome: 'voar', consulta: 'kw:flying' },
];

/** No máximo três: mais que isso o deck vira um pouco de tudo, que é nada. */
export const MAX_TEMAS = 3;

/** Texto de todas as faces: comandante de dupla face tem o tema no verso também. */
function textoDe(carta: CartaComTexto): string {
  const faces = carta.card_faces?.map((f) => f.oracle_text ?? '') ?? [];
  return [carta.oracle_text ?? '', ...faces].join('\n');
}

/** Os subtipos de criatura: o que vem depois do travessão, em qualquer face. */
export function subtiposDe(carta: CartaComTexto): string[] {
  const linhas = [
    carta.type_line ?? '',
    ...(carta.card_faces?.map((f) => f.type_line ?? '') ?? []),
  ];
  const tipos = new Set<string>();
  for (const linha of linhas) {
    const [antes, depois] = linha.split('—');
    if (!depois || !/creature/i.test(antes ?? '')) continue;
    for (const t of depois.trim().split(/\s+/)) if (t) tipos.add(t);
  }
  return [...tipos];
}

export function temasDoComandante(carta: CartaComTexto): Tema[] {
  const texto = textoDe(carta);
  const temas: Tema[] = [];

  // Tribo primeiro: "outro Dinossauro" é o tema mais forte que existe.
  for (const tipo of subtiposDe(carta)) {
    // "non-Human" (Kinnan) é o CONTRÁRIO de pedir humanos: citação negada não
    // conta.
    const citada = new RegExp(`(?<!non-)\\b${tipo}s?\\b`, 'i').test(texto);
    if (TRIBOS.has(tipo) || citada) {
      temas.push({ nome: `tribo ${tipo}`, consulta: `t:${tipo.toLowerCase()}` });
    }
  }

  for (const m of MECANICAS) {
    if (temas.length >= MAX_TEMAS) break;
    if (m.padrao.test(texto) && !temas.some((t) => t.consulta === m.consulta)) {
      temas.push({ nome: m.nome, consulta: m.consulta });
    }
  }

  return temas.slice(0, MAX_TEMAS);
}
