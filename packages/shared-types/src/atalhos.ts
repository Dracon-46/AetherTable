/**
 * atalhos.ts — catálogo de ações mapeáveis e a gramática de uma tecla.
 *
 * ─── POR QUE ISTO SAIU DO FRONTEND E VIROU CONTRATO ────────────────────────
 *
 * O teclado da mesa era um `switch (e.key.toLowerCase())` com as teclas
 * escritas no meio do código, e uma tabela `ATALHOS[]` ao lado, escrita à mão,
 * para a ajuda mostrar. Duas listas, uma verdade: bastava alguém trocar uma
 * tecla no `switch` e esquecer a tabela para a ajuda passar a mentir.
 *
 * Pior: `user_preferences.keybindings` existe no banco desde a primeira
 * migração — com o comentário dizendo que é JSONB "porque o conjunto de ações
 * mapeáveis muda a cada versão" — e NUNCA foi lida nem escrita por ninguém. O
 * esquema já esperava atalhos remapeáveis; faltava o catálogo que dá sentido
 * às chaves daquele JSON.
 *
 * Aqui está esse catálogo. O cliente desenha o editor a partir dele e resolve
 * as teclas por ele; o servidor valida as chaves recebidas contra ele. Uma
 * ação nova é uma linha em `ACOES_DE_ATALHO` mais um `case` no cliente — e a
 * ajuda, o editor e a validação passam a conhecê-la de graça.
 *
 * ─── A GRAMÁTICA DE UMA TECLA, E AS TRÊS DECISÕES DELA ─────────────────────
 *
 * Uma tecla é uma string canônica: `[ctrl+][alt+]<tecla>`, por exemplo `'d'`,
 * `'='`, `'escape'`, `'ctrl+z'`, `'alt+1'`.
 *
 * 1. NÃO EXISTE PREFIXO `shift+` PARA CARACTERE IMPRIMÍVEL, e não é omissão: o
 *    navegador já entrega o Shift embutido no caractere. Shift+P chega como
 *    `'P'` e P sozinho como `'p'`. Preservar a caixa é o que torna os dois
 *    atalhos distintos sem inventar um prefixo que colidiria com o caractere
 *    deslocado — `Shift + =` chega como `'+'`, e `'shift++'` contra `'+'` seria
 *    a mesma tecla física com dois nomes.
 *
 *    Para tecla NOMEADA (`Escape`, `ArrowUp`) o Shift não muda o nome, então
 *    ali ele entra como prefixo.
 *
 * 2. `ctrl` E `meta` COLAPSAM NO MESMO PREFIXO. Cmd no macOS e Ctrl no Windows
 *    são o mesmo gesto para quem joga, e gravar dois atalhos por ação
 *    obrigaria o jogador a remapear de novo ao trocar de máquina.
 *
 * 3. `alt` NÃO COLAPSA em nada. Ele é o modificador que o próprio tabuleiro já
 *    usa no mouse (Alt+clique inspeciona a carta) e é o único que muda o
 *    caractere entregue em alguns layouts — misturá-lo com Ctrl produziria
 *    atalhos que disparam sem o jogador entender por quê.
 */

/** Toda ação da mesa que pode ter tecla. A ordem é a de exibição no editor. */
export type AcaoDeAtalho =
  | 'COMPRAR'
  | 'DESVIRAR_TUDO'
  | 'EMBARALHAR'
  | 'PASSAR_TURNO'
  | 'DESFAZER'
  | 'VIRAR_SELECAO'
  | 'VIRAR_PARA_BAIXO'
  | 'TRANSFORMAR'
  | 'PARA_CEMITERIO'
  | 'EDITAR_CARTA'
  | 'LIMPAR_SELECAO'
  | 'AUMENTAR_CARTA'
  | 'REDUZIR_CARTA';

/**
 * Agrupamento do editor.
 *
 *   MESA     — vale sempre, não olha a seleção.
 *   SELECAO  — só faz algo com carta selecionada.
 *   EXIBICAO — mexe em preferência de quem olha, não no estado da mesa.
 */
export type GrupoDeAtalho = 'MESA' | 'SELECAO' | 'EXIBICAO';

export interface AcaoDeAtalhoMeta {
  id: AcaoDeAtalho;
  /** Texto mostrado na ajuda e no editor. */
  descricao: string;
  grupo: GrupoDeAtalho;
}

export const ACOES_DE_ATALHO: readonly AcaoDeAtalhoMeta[] = [
  { id: 'COMPRAR', descricao: 'Comprar uma carta', grupo: 'MESA' },
  { id: 'DESVIRAR_TUDO', descricao: 'Desvirar todas as suas permanentes', grupo: 'MESA' },
  { id: 'EMBARALHAR', descricao: 'Embaralhar o grimório', grupo: 'MESA' },
  { id: 'PASSAR_TURNO', descricao: 'Passar o turno', grupo: 'MESA' },
  { id: 'DESFAZER', descricao: 'Desfazer a última ação', grupo: 'MESA' },
  { id: 'VIRAR_SELECAO', descricao: 'Virar / desvirar a seleção', grupo: 'SELECAO' },
  {
    id: 'VIRAR_PARA_BAIXO',
    descricao: 'Virar a seleção para baixo / para cima',
    grupo: 'SELECAO',
  },
  { id: 'TRANSFORMAR', descricao: 'Transformar (dupla face)', grupo: 'SELECAO' },
  { id: 'PARA_CEMITERIO', descricao: 'Mandar a seleção para o cemitério', grupo: 'SELECAO' },
  {
    id: 'EDITAR_CARTA',
    descricao: 'Marcadores, P/T e dano da carta selecionada',
    grupo: 'SELECAO',
  },
  { id: 'LIMPAR_SELECAO', descricao: 'Limpar a seleção / fechar painel', grupo: 'SELECAO' },
  { id: 'AUMENTAR_CARTA', descricao: 'Aumentar o tamanho da carta', grupo: 'EXIBICAO' },
  { id: 'REDUZIR_CARTA', descricao: 'Reduzir o tamanho da carta', grupo: 'EXIBICAO' },
];

/** Uma ação sem tecla. Existe como valor gravável: "eu quero isto desligado". */
export const TECLA_NAO_ATRIBUIDA = '';

/**
 * As teclas de fábrica. Continuam sendo as que a mesa já usava — remapear é
 * recurso novo, mudar a mão de quem já jogava não.
 */
export const ATALHOS_PADRAO: Readonly<Record<AcaoDeAtalho, string>> = {
  COMPRAR: 'd',
  DESVIRAR_TUDO: 'u',
  EMBARALHAR: 's',
  PASSAR_TURNO: 'p',
  DESFAZER: 'ctrl+z',
  VIRAR_SELECAO: 't',
  VIRAR_PARA_BAIXO: 'f',
  TRANSFORMAR: 'x',
  PARA_CEMITERIO: 'g',
  EDITAR_CARTA: 'e',
  LIMPAR_SELECAO: 'escape',
  AUMENTAR_CARTA: '=',
  REDUZIR_CARTA: '-',
};

/** Só o formato mínimo de um evento de teclado. Este pacote não vê o DOM. */
export interface EventoDeTecla {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Teclas que valem como OUTRA tecla quando não têm mapeamento próprio.
 *
 * `+` e `_` são o que chega quando o jogador aperta `=` e `-` num teclado em
 * que essas posições exigem Shift (ABNT2) ou no bloco numérico. O gesto físico
 * é o mesmo; o caractere entregue não. Sem isto, "aumentar a carta" funcionaria
 * em teclado americano e falharia em silêncio num brasileiro.
 *
 * O apelido só é consultado quando a tecla apertada NÃO tem ação própria —
 * senão remapear algo para `+` viraria um atalho que dispara `=`.
 */
export const ALIAS_DE_TECLA: Readonly<Record<string, string>> = {
  '+': '=',
  _: '-',
};

/**
 * Traduz um evento de teclado na string canônica.
 *
 * Determinística e sem estado: a mesma tecla física sempre produz a mesma
 * string, tanto na captura do editor ("aperte a tecla nova") quanto na
 * resolução durante a partida. É o que garante que o que o jogador viu gravado
 * é exatamente o que vai disparar.
 */
export function normalizarTecla(e: EventoDeTecla): string {
  const nomeada = e.key.length > 1;
  // Tecla nomeada não muda de nome com Shift, então ali o Shift é prefixo.
  // Caractere imprimível já vem deslocado ('P', '+'), e a caixa é preservada.
  const base = nomeada ? e.key.toLowerCase() : e.key;
  const partes: string[] = [];
  if (e.ctrlKey || e.metaKey) partes.push('ctrl');
  if (e.altKey) partes.push('alt');
  if (nomeada && e.shiftKey) partes.push('shift');
  partes.push(base);
  return partes.join('+');
}

/** Teto de tamanho de uma tecla gravada. `ctrl+alt+shift+arrowright` tem 24. */
export const TAMANHO_MAX_DA_TECLA = 32;

export function ehAcaoDeAtalho(id: string): id is AcaoDeAtalho {
  return ACOES_DE_ATALHO.some((a) => a.id === id);
}

/**
 * A tecla tem forma gravável?
 *
 * Deliberadamente frouxa quanto à GRAMÁTICA e rígida quanto ao ABUSO. O
 * cliente é o único escritor e sempre grava o que `normalizarTecla` devolveu,
 * então validar a ordem dos prefixos aqui só criaria uma segunda gramática para
 * manter em sincronia.
 *
 * E o modo de falhar é seguro, diferente de um id de cosmético inválido: uma
 * tecla que não corresponde a nenhuma tecla real simplesmente nunca dispara —
 * não desenha nada errado e não emite intenção nenhuma. O que precisa ser
 * barrado é o que ocupa banco e memória: string enorme, espaço, caractere de
 * controle.
 */
export function ehTeclaDeAtalho(tecla: string): boolean {
  if (tecla === TECLA_NAO_ATRIBUIDA) return true;
  if (tecla.length > TAMANHO_MAX_DA_TECLA) return false;
  for (const caractere of tecla) {
    const codigo = caractere.codePointAt(0) ?? 0;
    // Até 32 cobre controle e espaço; 127 é o DEL.
    if (codigo <= 32 || codigo === 127) return false;
  }
  return true;
}

/** Mapa completo: o padrão, com o que o jogador remapeou por cima. */
export function resolverAtalhos(
  salvos: Readonly<Record<string, string>> | null | undefined,
): Record<AcaoDeAtalho, string> {
  const fora = { ...ATALHOS_PADRAO } as Record<AcaoDeAtalho, string>;
  if (!salvos) return fora;
  for (const [id, tecla] of Object.entries(salvos)) {
    // Chave desconhecida é ignorada, e é o caminho de VOLTA de uma versão:
    // quem jogou numa build com uma ação que depois saiu não fica com um
    // atalho fantasma nem com um editor quebrado.
    if (ehAcaoDeAtalho(id) && typeof tecla === 'string' && ehTeclaDeAtalho(tecla)) {
      fora[id] = tecla;
    }
  }
  return fora;
}

/**
 * Qual ação responde a esta tecla.
 *
 * O índice é construído na hora porque são treze entradas: memoizar seria
 * guardar o resultado de uma conta que custa menos do que comparar as
 * dependências do cache.
 *
 * Quando duas ações apontam para a mesma tecla, vence a PRIMEIRA em
 * `ACOES_DE_ATALHO`. O editor avisa do conflito antes de gravar; esta função
 * precisa ser total de qualquer forma, porque o JSON vem do banco e pode ter
 * sido gravado por uma versão anterior do editor.
 */
export function acaoDaTecla(
  atalhos: Readonly<Record<AcaoDeAtalho, string>>,
  tecla: string,
): AcaoDeAtalho | null {
  for (const { id } of ACOES_DE_ATALHO) {
    if (atalhos[id] && atalhos[id] === tecla) return id;
  }
  const apelido = ALIAS_DE_TECLA[tecla];
  if (!apelido) return null;
  for (const { id } of ACOES_DE_ATALHO) {
    if (atalhos[id] && atalhos[id] === apelido) return id;
  }
  return null;
}
