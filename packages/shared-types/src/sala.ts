/**
 * sala.ts — contrato da CONFIGURAÇÃO de uma sala.
 *
 * ─── POR QUE ISTO NÃO CRESCEU DENTRO DE `room.ts` ──────────────────────────
 *
 * `room.ts` é o contrato do ESTADO EM TEMPO REAL: o que muta dezenas de vezes
 * por segundo enquanto a partida corre. Isto aqui é o contrato do que se
 * decide UMA vez, antes de a mesa existir, e que depois só o anfitrião mexe.
 * Misturar os dois faria `room.ts` ser importado por quem só quer montar um
 * formulário de criação de sala — e é ele que arrasta `ICard` e `IPlayer`.
 *
 * ─── A CONFIGURAÇÃO VIVE NO ESTADO DA SALA, NÃO NA QUERYSTRING ─────────────
 *
 * `maxClients` e `gameType` viajavam em `/play/CODE?maxClients=4&...` e de lá
 * para o `joinOrCreate`. QUEM ENTRA PELO CÓDIGO NUNCA RECEBEU ESSAS OPÇÕES:
 * a sala de espera do convidado mostrava números inventados enquanto a do
 * criador mostrava os certos. Os dois campos foram para o `RoomState` por
 * causa disso, e toda configuração nova segue o mesmo caminho —
 * `onCreate(options)` → campo no `RoomState` → o lobby lê do estado.
 *
 * ─── `normalizarConfigDeSala` É CHAMADA PELOS DOIS LADOS, DE PROPÓSITO ─────
 *
 * O cliente chama para que o formulário nunca ofereça uma combinação que o
 * servidor vai recusar; o servidor chama porque as opções chegam ESCRITAS
 * PELO NAVEGADOR e não são assinadas — nada impedia um cliente de abrir uma
 * mesa de Duel Commander com oito assentos. Duas implementações da mesma
 * regra divergiriam na primeira mudança de catálogo, e a divergência
 * apareceria como "criei a mesa e ela abriu diferente do que eu escolhi".
 */

import { acharFormato } from './format';
import { REALTIME_LIMITS } from './room';

// ─── Visibilidade ────────────────────────────────────────────────────────────

/**
 * PRIVADA significa NÃO LISTADA. Não existe senha de sala, e a ausência é
 * deliberada: o `seatToken` já governa a entrada (assinado, uso único via
 * `jti`, vinculado ao `roomCode`, TTL de um dia). Uma senha seria um SEGUNDO
 * caminho de autenticação para o mesmo recurso, mais fraco que o primeiro —
 * digitável, compartilhável e sem expiração. Privada = não aparece em
 * `GET /salas`; entra quem tem o código.
 */
export const VISIBILIDADES = ['PRIVADA', 'PUBLICA'] as const;
export type Visibilidade = (typeof VISIBILIDADES)[number];

// ─── Sinalização social ──────────────────────────────────────────────────────

/**
 * Como a mesa pretende conversar. É SINALIZAÇÃO, não imposição: o sistema não
 * desliga a voz de ninguém em mesa `TEXTO`, nem exige microfone em mesa `VOZ`.
 * Serve para filtrar a lista e dizer a intenção antes de alguém sentar — a voz
 * continua sendo do LiveKit e disponível de qualquer forma.
 */
export const MODOS_DE_COMUNICACAO = ['QUALQUER', 'VOZ', 'TEXTO'] as const;
export type ModoDeComunicacao = (typeof MODOS_DE_COMUNICACAO)[number];

/** Idiomas de mesa. Mesma lista de `UserPreference.language`, e de propósito. */
export const IDIOMAS_DE_MESA = ['pt-BR', 'en-US', 'es-ES'] as const;
export type IdiomaDeMesa = (typeof IDIOMAS_DE_MESA)[number];

/** Rótulo legível de um idioma, para o seletor e para a lista de salas. */
export const NOME_DO_IDIOMA: Readonly<Record<IdiomaDeMesa, string>> = {
  'pt-BR': 'Português',
  'en-US': 'English',
  'es-ES': 'Español',
};

/** Rótulo legível de um modo de comunicação. */
export const NOME_DA_COMUNICACAO: Readonly<Record<ModoDeComunicacao, string>> = {
  QUALQUER: 'Voz ou texto',
  VOZ: 'Preferência por voz',
  TEXTO: 'Só texto',
};

// ─── Nível de poder ──────────────────────────────────────────────────────────

export interface NivelDePoder {
  valor: 1 | 2 | 3 | 4 | 5;
  nome: string;
  resumo: string;
}

/**
 * ─── DECLARADO PELO ANFITRIÃO, NUNCA CALCULADO ─────────────────────────────
 *
 * Os cinco brackets oficiais de Commander, traduzidos. A diferença entre isto
 * e o que outras plataformas fazem é inteira: elas CALCULAM o bracket a partir
 * da lista do deck e usam o nível da sala como filtro real. Nós não temos
 * calculador de bracket — nem teríamos como ter sem a classificação de cartas
 * de jogo rápido, de tutores e de combos de duas peças que ele exige.
 *
 * Um seletor que PARECE validar deck e não valida é pior que seletor nenhum:
 * ele vira discussão na mesa sobre uma garantia que o sistema nunca deu. Por
 * isso cada `resumo` termina dizendo que é declaração, e a interface tem de
 * usar a palavra "declarado" no rótulo.
 */
export const NIVEIS_DE_PODER: readonly NivelDePoder[] = [
  {
    valor: 1,
    nome: 'Exhibition',
    resumo: 'Mesa temática, sem intenção de ganhar rápido. Declarado, não verificado.',
  },
  {
    valor: 2,
    nome: 'Núcleo',
    resumo: 'Baralho de produto pronto ou pouco alterado. Declarado, não verificado.',
  },
  {
    valor: 3,
    nome: 'Aprimorado',
    resumo:
      'Deck ajustado, com boa base de mana e algumas cartas fortes. Declarado, não verificado.',
  },
  {
    valor: 4,
    nome: 'Otimizado',
    resumo:
      'Sem restrição de orçamento nem de poder, mas sem meta de cEDH. Declarado, não verificado.',
  },
  {
    valor: 5,
    nome: 'cEDH',
    resumo: 'Commander competitivo: ganhar o mais cedo possível. Declarado, não verificado.',
  },
];

/** Nome do nível, ou string vazia para "não declarado". */
export function nomeDoNivelDePoder(valor: number | null | undefined): string {
  const nivel = NIVEIS_DE_PODER.find((n) => n.valor === valor);
  return nivel ? `${nivel.valor} · ${nivel.nome}` : '';
}

// ─── Configuração da sala ────────────────────────────────────────────────────

export interface ConfigDeSala {
  nome: string;
  gameType: string;
  visibilidade: Visibilidade;
  comunicacao: ModoDeComunicacao;
  idioma: IdiomaDeMesa;
  maxClients: number;
  /** `null` = o anfitrião não declarou. Nunca é calculado. */
  nivelDePoder: number | null;
}

/**
 * Uma `ConfigDeSala` COMO ELA CHEGA, antes de qualquer garantia.
 *
 * Os valores sao `unknown` de proposito, e nao `Partial<ConfigDeSala>`: quem
 * chama `normalizarConfigDeSala` esta justamente entregando dados que nao
 * confia — a querystring do navegador, o corpo de uma requisicao, as `options`
 * cruas do `joinOrCreate`. Tipar a entrada como se ela ja fosse valida
 * obrigaria cada uma dessas pontas a mentir com um `as`, e um `as` é
 * exatamente o gesto que faz a checagem parecer feita quando não foi.
 *
 * As CHAVES continuam fechadas: um campo que não existe no contrato é erro de
 * compilação, o que mantém o valor de renomear um campo aqui.
 */
export type ConfigDeSalaBruta = { [K in keyof ConfigDeSala]?: unknown };

export const LIMITES_DE_SALA = { NOME_MIN: 3, NOME_MAX: 40 } as const;

const NOME_PADRAO = 'Mesa sem nome';

/**
 * Caracteres que não têm representação numa lista pública de salas.
 *
 * O `nome` é o campo perigoso deste contrato — é o único que aparece na lista
 * pública e no chat, escrito por quem cria a sala e lido por estranhos. É o
 * mesmo raciocínio do `username`: uma quebra de linha destrói o cartão da
 * lista, um caractere de controle atravessa o log, e os espaços de largura
 * zero produzem um nome que parece vazio na tela mas passa no `length`.
 */
// eslint-disable-next-line no-control-regex -- recusar caractere de controle e o objetivo desta regex
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/;

/** Colapsa espaços internos e apara as pontas. Um nome só de espaço vira ''. */
function aparar(bruto: unknown): string {
  if (typeof bruto !== 'string') return '';
  return bruto.replace(/\s+/g, ' ').trim();
}

/**
 * `true` quando o nome cabe na lista de salas.
 *
 * Recebe o nome CRU: apara antes de medir, porque `'  ab  '` tem seis
 * caracteres e dois de conteúdo — validar o comprimento do texto não aparado
 * deixaria passar exatamente o nome que a lista mostra vazio.
 */
export function ehNomeDeSala(nome: unknown): boolean {
  if (typeof nome !== 'string') return false;
  if (CONTROLE.test(nome)) return false;
  const limpo = aparar(nome);
  return limpo.length >= LIMITES_DE_SALA.NOME_MIN && limpo.length <= LIMITES_DE_SALA.NOME_MAX;
}

/** `true` quando o formato tem zona de comando — ver `nivelDePoder`. */
export function formatoTemNivelDePoder(gameType?: string | null): boolean {
  return acharFormato(gameType).comandante !== null;
}

function umDe<T extends string>(valores: readonly T[], bruto: unknown, padrao: T): T {
  return valores.includes(bruto as T) ? (bruto as T) : padrao;
}

/**
 * Aplica os limites do formato e devolve uma config SEMPRE válida.
 *
 * IDEMPOTENTE por contrato, e o teste cobre isso: normalizar o resultado de
 * uma normalização tem de dar o mesmo objeto. É o que permite chamá-la nas
 * duas pontas sem medo — o servidor renormaliza o que o cliente já normalizou,
 * e nenhum campo "escorrega" no caminho. O ponto que quase quebrou isso foi o
 * `gameType`: `acharFormato` cai no formato padrão para um id desconhecido,
 * mas se a função devolvesse o id CRU de volta, a segunda passada receberia o
 * mesmo id inválido — e o resultado dependeria de quantas vezes ela rodou.
 */
export function normalizarConfigDeSala(bruta: ConfigDeSalaBruta = {}): ConfigDeSala {
  const preset = acharFormato(typeof bruta.gameType === 'string' ? bruta.gameType : null);
  const gameType = preset.id;

  const nome = ehNomeDeSala(bruta.nome) ? aparar(bruta.nome) : NOME_PADRAO;

  // A faixa vem do PRESET, não de uma lista fixa: era o que permitia abrir uma
  // mesa de Duel Commander com seis pessoas. O teto absoluto do sistema entra
  // depois, porque um preset futuro pode declarar um máximo maior do que a
  // mesa sabe desenhar — e é `MAX_PLAYERS` quem dimensiona a reconciliação de
  // visibilidade. O piso de 1 é preservado: a mesa de UM jogador é caso de uso.
  const pedido = Number(bruta.maxClients);
  const base = Number.isInteger(pedido) && pedido > 0 ? pedido : preset.jogadores.padrao;
  const maxClients = Math.min(
    REALTIME_LIMITS.MAX_PLAYERS,
    Math.max(preset.jogadores.min, Math.min(preset.jogadores.max, base)),
  );

  // Nível de poder em Modern não quer dizer nada: os brackets são uma escala de
  // Commander. Zerar aqui é o que impede a lista pública de exibir "nível 4"
  // numa mesa de Pauper, onde o número não tem referência nenhuma.
  const declarado = Number(bruta.nivelDePoder);
  const nivelDePoder =
    preset.comandante !== null && NIVEIS_DE_PODER.some((n) => n.valor === declarado)
      ? declarado
      : null;

  return {
    nome,
    gameType,
    visibilidade: umDe(VISIBILIDADES, bruta.visibilidade, 'PRIVADA'),
    comunicacao: umDe(MODOS_DE_COMUNICACAO, bruta.comunicacao, 'QUALQUER'),
    idioma: umDe(IDIOMAS_DE_MESA, bruta.idioma, 'pt-BR'),
    maxClients,
    nivelDePoder,
  };
}

/**
 * O que sai de `normalizarConfigDeSala({})`.
 *
 * Derivado da própria função em vez de escrito à mão: um padrão duplicado
 * diverge no primeiro campo novo, e a divergência aparece como "criei sem
 * escolher nada e a mesa abriu diferente do formulário".
 */
export const CONFIG_DE_SALA_PADRAO: ConfigDeSala = normalizarConfigDeSala({});

/**
 * Uma linha da vitrine de salas públicas (`GET /salas` do game-server).
 *
 * É um DTO ENXUTO, e a estreiteza é o ponto: a rota lê os metadados que cada
 * sala publicou em `setMetadata`, e metadado é objeto livre. Devolver o
 * metadado cru faria qualquer campo interno que alguém guardasse ali no futuro
 * — um id de usuário, um contador de moderação — vazar numa rota pública sem
 * que nada no código da rota mudasse. Com este tipo, publicar um campo novo
 * exige editá-lo aqui, que é onde a decisão de publicar tem de ser tomada.
 */
export interface SalaPublica {
  roomCode: string;
  nome: string;
  gameType: string;
  comunicacao: ModoDeComunicacao;
  idioma: IdiomaDeMesa;
  /** 0 = o anfitrião não declarou. Nunca é calculado. */
  nivelDePoder: number;
  ocupacao: number;
  maxSeats: number;
  emPartida: boolean;
  /** Sem vaga: dá para assistir, não para entrar. */
  cheia: boolean;
}

/** Sugere um nome a partir do username, para quem só quer entrar e jogar. */
export function nomeDeSalaSugerido(username?: string | null): string {
  const dono = aparar(username);
  if (!dono) return NOME_PADRAO;
  const sugerido = `Mesa de ${dono}`;
  return ehNomeDeSala(sugerido) ? sugerido : sugerido.slice(0, LIMITES_DE_SALA.NOME_MAX).trim();
}

// ─── Configuração de JOGO (decidida na sala de espera) ───────────────────────
//
// A separação entre isto e `ConfigDeSala` não é organizacional, é de momento e
// de dono: `ConfigDeSala` é escrita na CRIAÇÃO e não muda mais; o que está
// abaixo o anfitrião ajusta na sala de espera, com a mesa já montada e vendo
// quem sentou. Por isso ela trafega por intenção autorizada e aquela não.

/**
 * COMMANDER — o primeiro mulligan é grátis (regra oficial desde 2019): só a
 *             partir do segundo o cliente devolve carta ao fundo, e sempre uma
 *             a menos do que o total, porque o grátis não conta. Ver
 *             `cartasParaDevolverNoMulligan`.
 * LONDON   — mesmo teto de sete no servidor; a diferença é do cliente, que
 *            compra sete e devolve N ao fundo, sem mulligan grátis.
 * LIVRE    — sem teto e sem as três condições que fecham a janela. É o
 *            formato-escape, e existe pelo mesmo motivo do formato `Livre` de
 *            deck: UM escape explícito e nomeado, em vez de meia dúzia de
 *            interruptores de "ignorar regra" espalhados pela interface.
 */
export const TIPOS_DE_MULLIGAN = ['COMMANDER', 'LONDON', 'LIVRE'] as const;
export type TipoDeMulligan = (typeof TIPOS_DE_MULLIGAN)[number];

/** Uma linha explicando qual regra está valendo, para o modal de mulligan. */
export const REGRA_DO_MULLIGAN: Readonly<Record<TipoDeMulligan, string>> = {
  COMMANDER:
    'Mulligan de Commander: o primeiro é grátis; do segundo em diante, devolva uma carta ao fundo por mulligan. O teto é sete.',
  LONDON: 'Mulligan de London: compre sete e devolva ao fundo uma carta por mulligan.',
  LIVRE: 'Mulligan livre: sem teto e sem janela. A mesa combina o resto.',
};

/**
 * Quantas cartas vão para o FUNDO quando o jogador mantém a mão.
 *
 * O servidor não participa desta conta: `INTENT_MULLIGAN` devolve a mão,
 * embaralha e compra sete em todos os tipos, e é o cliente que devolve N ao
 * fundo (ver o comentário de `TIPOS_DE_MULLIGAN`). Por isso a regra mora aqui,
 * e não no modal: era uma expressão dentro do JSX, sem teste nenhum, e o custo
 * saía errado justamente no caso mais comum da plataforma.
 *
 * COMMANDER dá o PRIMEIRO mulligan de graça — é a regra oficial desde 2019, e
 * é a razão de o tipo existir separado de LONDON. O modal usava `mulliganCount`
 * cru para os dois: quem jogava Commander e fazia um único mulligan já era
 * obrigado a devolver uma carta, ou seja, jogava London numa mesa que escolheu
 * Commander. Descontar o mulligan grátis é toda a diferença entre os dois.
 *
 * LIVRE não cobra nada. Não é só coerência com o nome: a janela do LIVRE não
 * tem teto, então `mulliganCount` passa de sete — e cobrar N cartas de uma mão
 * de sete deixaria a confirmação impossível de satisfazer, prendendo o jogador
 * na tela de devolução.
 *
 * `tipo` entra como `string` porque é o que chega do estado da sala, escrito
 * pelo navegador do anfitrião. Valor não reconhecido cai em COMMANDER, que é o
 * padrão da plataforma — a mesma queda que o modal já faz para o texto da
 * regra.
 */
export function cartasParaDevolverNoMulligan(tipo: string, mulliganCount: number): number {
  // `mulliganCount` vem do estado da sala e pode chegar negativo ou quebrado se
  // alguém mexer no schema; o piso em zero evita pedir "-1 cartas".
  const feitos = Number.isFinite(mulliganCount) ? Math.max(0, Math.floor(mulliganCount)) : 0;
  if (tipo === 'LONDON') return feitos;
  if (tipo === 'LIVRE') return 0;
  return Math.max(0, feitos - 1);
}

/**
 * ─── O CRONÔMETRO CONTA E AVISA. NUNCA AGE. ────────────────────────────────
 *
 * Não existe motor de regras (RN01). Um cronômetro que passasse o turno
 * sozinho seria a PRIMEIRA regra que o servidor impõe — e abriria a porta para
 * "então por que ele não desvira minhas permanentes também", que é exatamente
 * a ladeira que RN01 existe para não descer. Ele marca o tempo do turno atual,
 * destaca quando passa do limite, e para aí. Quem passa o turno é o jogador.
 *
 * O cliente calcula a partir de `turnoIniciadoEm` em vez de receber um tique
 * por segundo: um `broadcast` por segundo por sala seria tráfego constante
 * numa mesa que fica minutos parada pensando.
 */

/**
 * Durações aceitas do cronômetro de turno, em segundos. `0` = desligado.
 *
 * LISTA FECHADA, e não um número livre: um campo aberto convida ao `1`, e um
 * cronômetro de um segundo transforma o aviso — que é a única coisa que ele
 * faz — em ruído permanente na tela de todo mundo.
 */
export const CRONOMETROS_DE_TURNO = [0, 60, 120, 180, 300] as const;
export type CronometroDeTurno = (typeof CRONOMETROS_DE_TURNO)[number];

/** Rótulo legível de uma duração de cronômetro. */
export function nomeDoCronometro(segundos: number): string {
  if (!segundos) return 'Desligado';
  return segundos % 60 === 0 ? `${segundos / 60} min` : `${segundos}s`;
}
