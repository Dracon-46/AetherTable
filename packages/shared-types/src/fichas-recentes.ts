/**
 * fichas-recentes.ts — as fichas que a pessoa criou por último, na conta.
 *
 * ─── POR QUE ISTO EXISTE ───────────────────────────────────────────────────
 *
 * O "Usadas recentemente" do seletor de fichas guardava a lista só no
 * `localStorage`. Quem joga com fichas cria as MESMAS a partida inteira — os
 * Soldados do próprio deck, a Planta do Avenger —, e trocar de máquina
 * esvaziava a fileira justamente na partida em que ela mais ajudava.
 *
 * Mora em `user_preferences.fichas_recentes` (JSONB, padrão `[]`), e o formato
 * é EXATAMENTE o que o seletor já guardava: o bastante para recriar a ficha
 * pela mesma intenção `INTENT_CREATE_TOKEN`. Os limites de cada texto são os
 * do `CreateTokenIntent` do game-server — uma ficha que o servidor da mesa
 * recusaria não tem por que ser lembrada.
 */

/** O que basta para recriar uma ficha: impressão (se houver), nome e P/R. */
export interface FichaRecente {
  /** Id da Scryfall (uuid). Ausente na ficha personalizada, só com nome e P/R. */
  scryfallId?: string;
  name: string;
  power?: string;
  toughness?: string;
}

/** O teto da lista NA CONTA. O seletor mostra menos; a folga é para versões futuras. */
export const MAX_FICHAS_RECENTES = 12;
/** Os mesmos tetos de `CreateTokenIntent` no game-server. */
export const MAX_NOME_DE_FICHA = 120;
export const MAX_PODER_OU_RESISTENCIA = 4;

/** O formato de um id da Scryfall. */
export const PADRAO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Duas entradas são a mesma ficha? Pela impressão; sem impressão, pelo nome. */
export function mesmaFicha(a: FichaRecente, b: FichaRecente): boolean {
  return a.scryfallId ? a.scryfallId === b.scryfallId : !b.scryfallId && a.name === b.name;
}

/** Ausente, ou texto de até `max`. */
function opcionalCurto(v: unknown, max: number): v is string | undefined {
  return v === undefined || (typeof v === 'string' && v.length <= max);
}

/** Ausente, ou um id da Scryfall. */
function uuidOpcional(v: unknown): v is string | undefined {
  return v === undefined || (typeof v === 'string' && PADRAO_DE_UUID.test(v));
}

/**
 * Uma entrada válida, ou `null`.
 *
 * Aqui a regra é diferente da das preferências: uma ficha com campo estranho
 * é DESCARTADA, não consertada. Um `scryfallId` que não é uuid ou um P/R de
 * cinco letras fariam a mesa recusar a intenção inteira, e "consertar"
 * tirando o campo criaria uma ficha (sem arte, sem P/R) que a pessoa nunca
 * escolheu. Chave desconhecida não entra na saída.
 */
function fichaValida(v: unknown): FichaRecente | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  if (!name || name.length > MAX_NOME_DE_FICHA) return null;
  const { scryfallId, power, toughness } = f;
  if (!uuidOpcional(scryfallId)) return null;
  if (!opcionalCurto(power, MAX_PODER_OU_RESISTENCIA)) return null;
  if (!opcionalCurto(toughness, MAX_PODER_OU_RESISTENCIA)) return null;
  return {
    ...(scryfallId !== undefined ? { scryfallId } : {}),
    name,
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
  };
}

/**
 * Qualquer coisa vinda do banco ou do `localStorage` vira uma lista limpa:
 * entradas inválidas fora, repetidas fora (vale a primeira, a mais recente),
 * no máximo `max` itens. **Nunca falha.**
 */
export function normalizarFichasRecentes(
  entrada: unknown,
  max: number = MAX_FICHAS_RECENTES,
): FichaRecente[] {
  if (!Array.isArray(entrada)) return [];
  const saida: FichaRecente[] = [];
  for (const bruto of entrada) {
    const f = fichaValida(bruto);
    if (f && !saida.some((s) => mesmaFicha(s, f))) saida.push(f);
    if (saida.length >= max) break;
  }
  return saida;
}
