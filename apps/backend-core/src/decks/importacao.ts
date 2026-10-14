import { BoardType } from '@prisma/client';
import type { CardIdentifier } from '@aethertable/scryfall-client';

/**
 * importacao.ts — da lista colada às linhas do deck.
 *
 * ─── POR QUE O PARSER SAIU DO SERVIÇO ───────────────────────────────────────
 *
 * Ele morava dentro de `importDeckList`, entre uma consulta ao banco e uma
 * chamada à Scryfall, e por isso nenhuma das regras abaixo tinha teste. Quatro
 * defeitos conviviam ali:
 *
 *  1. **CABEÇALHO NÃO MUDAVA DE SEÇÃO.** A linha "Sideboard" era pulada, mas as
 *     cartas DEPOIS dela entravam no MAIN: a reserva de quinze cartas virava
 *     parte do deck de sessenta. "Commander", "Deck", "Companion" e "About"
 *     (o formato do Arena) iam à Scryfall como nome de carta.
 *  2. **A MESMA CARTA EM DUAS LINHAS PERDIA UMA DELAS.** "4 Forest (ZNR)" e
 *     "6 Forest (M21)" voltavam da Scryfall como duas "Forest", e o casamento
 *     por nome achava SEMPRE a primeira linha: o deck ficava com 4 + 4. E duas
 *     linhas com a mesma impressão no mesmo board batiam na chave única do
 *     `createMany` — erro 500 e import perdido.
 *  3. **MARCADORES DE EXPORTADOR VIRAVAM PARTE DO NOME.** As categorias do
 *     Archidekt (`[Ramp,Artifact]`), as etiquetas (`^Have,#37d67a^`) e o foil
 *     do Moxfield (`*F*`) chegavam à Scryfall grudados no nome, e a carta não
 *     era encontrada.
 *  4. **QUANTIDADE SEM TETO.** "2000000000 Forest" era gravado assim, e o
 *     game-server travava criando as cartas na entrada da mesa.
 */

/**
 * Teto de cópias por linha — o mesmo de `AdicionarCartaDto`. O schema documenta
 * `1..99` num comentário, mas nenhuma migração criou o `CHECK`: quem segura o
 * teto é o código, e por isso ele precisa valer em TODO caminho de escrita.
 */
export const MAXIMO_DE_COPIAS = 99;

export interface LinhaImportada {
  quantidade: number;
  /** Como o jogador escreveu, para a mensagem de "não encontrada". */
  nome: string;
  set?: string;
  boardType: BoardType;
}

export interface ListaAnalisada {
  linhas: LinhaImportada[];
  /** Linhas recusadas, já no texto que a tela mostra em "não encontradas". */
  recusadas: string[];
}

/**
 * Os cabeçalhos dos exportadores, e a seção que cada um abre.
 *
 * `null` é seção IGNORADA: o "About" do Arena traz "Name Meu Deck", que não é
 * carta e não pode ir à Scryfall como uma.
 *
 * Companion vai para a reserva porque é onde as regras o põem (ele começa o
 * jogo fora do deck, revelado da reserva).
 */
const SECOES = new Map<string, BoardType | null>([
  ['deck', BoardType.MAIN],
  ['main', BoardType.MAIN],
  ['mainboard', BoardType.MAIN],
  ['maindeck', BoardType.MAIN],
  ['main deck', BoardType.MAIN],
  ['sideboard', BoardType.SIDEBOARD],
  ['side', BoardType.SIDEBOARD],
  ['companion', BoardType.SIDEBOARD],
  ['commander', BoardType.COMMANDER],
  ['commanders', BoardType.COMMANDER],
  ['maybeboard', BoardType.MAYBEBOARD],
  ['maybe', BoardType.MAYBEBOARD],
  ['considering', BoardType.MAYBEBOARD],
  ['about', null],
]);

/**
 * A seção que a linha abre, `null` para seção ignorada, ou `undefined` quando
 * a linha não é cabeçalho.
 *
 * Aceita as variações reais: "Sideboard", "SIDEBOARD:", "// Sideboard",
 * "Sideboard (15)". Só linha SEM quantidade na frente é candidata — "1 Deck"
 * seria uma carta.
 */
function secaoDoCabecalho(linha: string): BoardType | null | undefined {
  const m = linha.match(/^(?:\/\/|#)?\s*([A-Za-z][A-Za-z ]*?)\s*(?:\(\d+\))?\s*:?\s*$/);
  if (!m) return undefined;
  const nome = m[1]!.toLowerCase();
  return SECOES.has(nome) ? SECOES.get(nome)! : undefined;
}

/** O board que uma categoria do Archidekt indica, quando indica algum. */
function boardDaCategoria(conteudo: string): BoardType | undefined {
  for (const parte of conteudo.split(',')) {
    // `{top}`, `{noDeck}`, `{noPrice}` são flags da categoria, não o nome dela.
    const nome = parte
      .replace(/\{[^}]*\}/g, '')
      .trim()
      .toLowerCase();
    if (nome === 'commander') return BoardType.COMMANDER;
    if (nome === 'sideboard') return BoardType.SIDEBOARD;
    if (nome === 'maybeboard') return BoardType.MAYBEBOARD;
  }
  // Categoria marcada "fora do deck" no Archidekt é o maybeboard dele.
  if (/\{nodeck\}/i.test(conteudo)) return BoardType.MAYBEBOARD;
  return undefined;
}

/**
 * Tira da linha o que não é nome de carta, devolvendo o board que um
 * marcador indicou (o `*CMDR*` do TappedOut, a categoria `[Commander]` do
 * Archidekt).
 *
 * `[XYZ]` em MAIÚSCULAS, de 2 a 5 caracteres e sem `(set)` antes, continua
 * sendo código de coleção — é o formato "1 Sol Ring [C21]". Qualquer outro
 * colchete é categoria: "[Ramp]" não é coleção nenhuma, e mandá-lo como `set`
 * fazia a Scryfall não achar a carta.
 */
function limparMarcadores(linha: string): { texto: string; board?: BoardType } {
  let board: BoardType | undefined;
  let texto = linha;

  if (/\*CMDR\*/i.test(texto)) board = BoardType.COMMANDER;
  texto = texto.replace(/\*[A-Za-z]{1,4}\*/g, ' ');
  texto = texto.replace(/\^[^^]*\^/g, ' ');

  const temSetEntreParenteses = /\([A-Za-z0-9]{2,6}\)/.test(texto);
  texto = texto.replace(/\[([^\]]*)\]/g, (bloco: string, conteudo: string) => {
    if (!temSetEntreParenteses && /^[A-Z0-9]{2,5}$/.test(conteudo.trim())) return bloco;
    board ??= boardDaCategoria(conteudo);
    return ' ';
  });

  return { texto: texto.replace(/\s+/g, ' ').trim(), board };
}

const LINHA_DE_CARTA =
  /^\s*(?<qty>\d+)\s*[xX]?\s+(?<name>[^([#*]+?)\s*(?:\((?<set1>[A-Za-z0-9]{2,5})\)\s*(?<cn>\S+)?)?\s*(?:\[(?<set2>[A-Za-z0-9]{2,5})\])?\s*(?:#.*)?$/;

/** Lê a lista colada. Não fala com rede nem com banco. */
export function analisarListaDeImportacao(texto: string): ListaAnalisada {
  const linhas: LinhaImportada[] = [];
  const recusadas: string[] = [];
  // `null` = dentro de uma seção ignorada (o "About" do Arena).
  let secao: BoardType | null = BoardType.MAIN;

  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim();
    if (linha.length === 0) continue;

    const cabecalho = secaoDoCabecalho(linha);
    if (cabecalho !== undefined) {
      secao = cabecalho;
      continue;
    }
    if (secao === null) continue;
    // Comentário que não é cabeçalho ("// tokens", "# combo").
    if (linha.startsWith('#') || linha.startsWith('//')) continue;

    const { texto: limpa, board } = limparMarcadores(linha);
    if (limpa.length === 0) continue;

    let quantidade = 1;
    let nome = limpa;
    let set: string | undefined;

    const m = limpa.match(LINHA_DE_CARTA);
    if (m?.groups) {
      quantidade = Number(m.groups['qty']);
      nome = m.groups['name']!.trim();
      set = m.groups['set1'] ?? m.groups['set2'];
    } else {
      const simples = limpa.match(/^(\d+)x?\s+(.+)$/);
      if (simples) {
        quantidade = Number(simples[1]);
        nome = simples[2]!.trim();
      }
    }

    // Fora de 1–99 a linha não entra: zero não é carta, e acima do teto o
    // game-server criaria as cópias uma a uma na entrada da mesa.
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > MAXIMO_DE_COPIAS) {
      recusadas.push(`${nome}: quantidade ${quantidade} fora de 1–${MAXIMO_DE_COPIAS}`);
      continue;
    }

    linhas.push({ quantidade, nome, ...(set ? { set } : {}), boardType: board ?? secao });
  }

  return { linhas, recusadas };
}

/** Uma linha pronta para `deckCard.createMany`. */
export interface LinhaDoDeck {
  scryfallId: string;
  quantity: number;
  boardType: BoardType;
}

/** O pedido que a linha faz à Scryfall: mesmo nome e mesma coleção, mesmo pedido. */
function chaveDoPedido(l: { nome: string; set?: string }): string {
  return `${l.nome.toLowerCase()}|${l.set?.toLowerCase() ?? ''}`;
}

/**
 * Os identificadores para `/cards/collection`, um por pedido distinto.
 *
 * Quatro linhas de "Forest" sem coleção são UM pedido: repetir o identificador
 * gastava o lote de 75 da Scryfall com duplicatas.
 */
export function pedidosAScryfall(linhas: readonly LinhaImportada[]): CardIdentifier[] {
  const pedidos = new Map<string, CardIdentifier>();
  for (const l of linhas) {
    const chave = chaveDoPedido(l);
    if (!pedidos.has(chave)) {
      pedidos.set(chave, l.set ? { name: l.nome, set: l.set.toLowerCase() } : { name: l.nome });
    }
  }
  return [...pedidos.values()];
}

/**
 * Casa o que a Scryfall devolveu com as linhas lidas e junta as linhas que
 * apontam para a mesma impressão no mesmo board.
 */
export function casarResultados(
  linhas: readonly LinhaImportada[],
  encontradas: readonly { id: string; name: string; set: string }[],
): { linhasDoDeck: LinhaDoDeck[]; recusadas: string[]; importadas: number } {
  type Pedido = {
    nome: string;
    set?: string;
    rotulo: string;
    carta?: { id: string; name: string };
  };
  const pedidos = new Map<string, Pedido>();
  for (const l of linhas) {
    const chave = chaveDoPedido(l);
    if (!pedidos.has(chave)) {
      pedidos.set(chave, {
        nome: l.nome.toLowerCase(),
        ...(l.set ? { set: l.set.toLowerCase() } : {}),
        rotulo: l.set ? `${l.nome} (${l.set.toUpperCase()})` : l.nome,
      });
    }
  }

  const recusadas: string[] = [];

  for (const carta of encontradas) {
    /**
     * CASAMENTO DE NOME.
     *
     * A Scryfall devolve o nome CANÔNICO — para dupla face, "Delver of Secrets
     * // Insectile Aberration" —, e o jogador escreve a face da frente, como
     * todo exportador. Por isso a frente também casa, e o separador "/" de
     * quem digitou as duas faces à mão.
     *
     * Cada resultado ocupa UM pedido ainda livre, preferindo o da mesma
     * coleção. Casar sempre com o primeiro pedido de mesmo nome era o que
     * fazia "4 Forest (ZNR)" + "6 Forest (M21)" virar 4 + 4.
     */
    const alvo = carta.name.toLowerCase();
    const frente = alvo.split(' // ')[0]!;
    const casa = (nome: string) =>
      nome === alvo || nome === frente || nome.split(/\s*\/+\s*/)[0] === frente;

    const candidatos = [...pedidos.values()].filter((p) => casa(p.nome));
    if (candidatos.length === 0) {
      // A Scryfall achou e nós não casamos: defeito NOSSO, e precisa aparecer
      // para quem importou em vez de sumir em silêncio.
      recusadas.push(carta.name);
      continue;
    }
    const livres = candidatos.filter((p) => !p.carta);
    const escolhido =
      livres.find((p) => p.set === carta.set.toLowerCase()) ??
      livres.find((p) => !p.set) ??
      livres[0];
    // Sem pedido livre, é a mesma carta devolvida duas vezes: nada a fazer.
    if (escolhido) escolhido.carta = { id: carta.id, name: carta.name };
  }

  const porLinhaDoDeck = new Map<string, LinhaDoDeck & { nome: string; origens: number }>();
  for (const l of linhas) {
    const carta = pedidos.get(chaveDoPedido(l))!.carta;
    if (!carta) continue;
    // Minúsculas pelo mesmo motivo do DTO: a chave única do banco é por texto.
    const scryfallId = carta.id.toLowerCase();
    const chave = `${scryfallId}|${l.boardType}`;
    const atual = porLinhaDoDeck.get(chave);
    if (atual) {
      atual.quantity += l.quantidade;
      atual.origens += 1;
    } else {
      porLinhaDoDeck.set(chave, {
        scryfallId,
        quantity: l.quantidade,
        boardType: l.boardType,
        nome: carta.name,
        origens: 1,
      });
    }
  }

  for (const p of pedidos.values()) if (!p.carta) recusadas.push(p.rotulo);

  const linhasDoDeck: LinhaDoDeck[] = [];
  let importadas = 0;
  for (const { nome, origens, ...linha } of porLinhaDoDeck.values()) {
    // Duas linhas válidas podem somar acima do teto ("60 Forest" duas vezes).
    if (linha.quantity > MAXIMO_DE_COPIAS) {
      recusadas.push(
        `${nome}: ${linha.quantity} cópias somadas, o máximo por carta é ${MAXIMO_DE_COPIAS}`,
      );
      continue;
    }
    linhasDoDeck.push(linha);
    importadas += origens;
  }

  return { linhasDoDeck, recusadas, importadas };
}
