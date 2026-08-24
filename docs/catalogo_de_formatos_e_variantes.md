# Catálogo de Formatos e Variantes

| Campo | Valor |
|---|---|
| **ID** | `DOC-037` |
| **Versão** | 1.0 |
| **Status** | Estável |
| **Última revisão** | 2026-08-21 |
| **Documentos relacionados** | [readme.md](readme.md) · [catalogo_de_acoes_da_mesa.md](catalogo_de_acoes_da_mesa.md) · [especificacao_do_motor_sandbox.md](especificacao_do_motor_sandbox.md) · [modelo_de_dados.md](modelo_de_dados.md) |

> **Mudança de escopo registrada.** O produto passa de "plataforma de Commander" para **sandbox geral
> de Magic**, com Commander como formato-vitrine. Este documento enumera **todos** os formatos e
> variantes suportáveis e define como cada um é expresso no sistema.

---

## 1. A tese: formato é dado, não código

Num sandbox **sem motor de regras**, um formato não precisa de lógica própria. Ele é um **preset
declarativo** que responde a seis perguntas:

1. Quantos jogadores?
2. Times? Vida compartilhada?
3. Quanta vida inicial e quantas cartas na mão inicial?
4. Que avisos de validação de deck? (tamanho, singleton, raridade, banlist)
5. Quais zonas existem na mesa?
6. Precisa de comandante? De baralho extra?

Isso é um objeto de configuração. **Nenhum `if (formato === 'X')` no motor.**

```
                    ┌──────────────────────────┐
                    │   FormatPreset (dado)    │
                    │  players · life · zones  │
                    │  deck rules · commander  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
      Validação de deck    Provisionamento     Layout da mesa
      (avisos, RN05)       da sala (onJoin)    (zonas visíveis)
```

**Consequência prática:** adicionar um formato novo é escrever ~15 linhas de JSON. Adicionar
*Oathbreaker*, *Tiny Leaders* ou *Pauper EDH* custa minutos, não sprints.

### 1.1 O que realmente custa caro

Só três coisas exigem **máquina nova**, não configuração:

| Necessidade | Formatos afetados | Esforço | Fase |
|---|---|---|---|
| **Motor de draft** (gerar pacotes, passar, cronometrar) | Booster, Cube, Winston, Grid, Rochester, Solomon, Team, Chaos, Jumpstart | **Alto** — é um subsistema | V3 |
| **Vida compartilhada + times** | Two-Headed Giant, Emperor, Archenemy, Team Unified | **Médio** | V1 |
| **Baralho automatizado** (Horda joga sozinha) | Horde Magic | Médio | V2 |

Todo o resto — **mais de 30 formatos** — é preset puro.

### 1.2 O formato mais importante é o mais simples

**`FREEFORM` (mesa de cozinha).** Zero validação, deck de qualquer tamanho, qualquer carta, vida e
número de jogadores configuráveis à mão.

É o formato **padrão de fallback** e provavelmente o mais usado: é o que permite testar uma ideia
maluca, jogar um formato caseiro do grupo, ou usar a mesa para qualquer coisa que não previmos.
Coerente com `RN01` — o sistema oferece as peças, não julga.

---

## 2. Estrutura do preset

```ts
// packages/shared-types/src/format.ts
export interface FormatPreset {
  id: string;                    // 'commander', 'modern', 'oathbreaker'
  name: string;                  // rótulo exibido
  category: FormatCategory;
  status: 'STABLE' | 'BETA' | 'PLANNED';

  players: { min: number; max: number; default: number };
  teams: { size: number; sharedLife: boolean } | null;

  startingLife: number;
  startingHandSize: number;      // 7 na maioria; Vanguard altera
  maxHandSize: number | null;    // null = sem limite (Freeform)

  deck: {
    minSize: number | null;
    maxSize: number | null;
    exactSize: number | null;    // Commander: 100
    singleton: boolean;
    maxCopies: number;           // 4 no constructed, 1 no singleton
    sideboard: { min: number; max: number } | null;
    rarityCeiling: 'common' | 'uncommon' | null;   // Pauper, Peasant
    maxManaValue: number | null;                    // Tiny Leaders: 3
    legalityKey: string | null;  // chave em legalities da Scryfall
    pointsList: string | null;   // Canadian Highlander
  };

  commander: {
    count: 1 | 2;
    cardType: 'creature' | 'planeswalker';
    signatureSpell: boolean;     // Oathbreaker
    enforceColorIdentity: boolean;
    tax: boolean;                // taxa cumulativa de +2
  } | null;

  zones: ZoneId[];               // quais existem nesta mesa
  extraDecks: ExtraDeck[];       // planar, scheme, attraction, contraption, horde
  requiresDraftEngine: boolean;
}
```

**Nota sobre `legalityKey`:** a Scryfall já devolve `legalities` com chave por formato (`standard`,
`modern`, `commander`, `pauper`, `vintage`, `brawl`, `oathbreaker`, `duel`, `premodern`, `oldschool`…).
Reaproveitar essa chave significa que **a banlist vem de graça e sempre atualizada** — nós não mantemos
lista nenhuma. Ver [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) §6.2.

**Validação continua não bloqueante** em todos os formatos (`RN05`): o sistema **avisa**, nunca impede.

---

## 3. Formatos construídos — 1v1, 60 cartas

| ID | Formato | Deck | Cópias | Sideboard | Vida | Jog. | `legalityKey` | Fase |
|---|---|---|---|---|---|---|---|---|
| `standard` | **Standard** | ≥ 60 | 4 | 0–15 | 20 | 2 | `standard` | MVP |
| `pioneer` | **Pioneer** | ≥ 60 | 4 | 0–15 | 20 | 2 | `pioneer` | MVP |
| `modern` | **Modern** | ≥ 60 | 4 | 0–15 | 20 | 2 | `modern` | MVP |
| `legacy` | **Legacy** | ≥ 60 | 4 | 0–15 | 20 | 2 | `legacy` | MVP |
| `vintage` | **Vintage** | ≥ 60 | 4 (restritas: 1) | 0–15 | 20 | 2 | `vintage` | MVP |
| `pauper` | **Pauper** | ≥ 60 | 4 | 0–15 | 20 | 2 | `pauper` | MVP |
| `premodern` | **Premodern** | ≥ 60 | 4 | 0–15 | 20 | 2 | `premodern` | V1 |
| `oldschool` | **Old School 93/94** | ≥ 60 | 4 | 0–15 | 20 | 2 | `oldschool` | V1 |
| `historic` | **Historic** | ≥ 60 | 4 | 0–15 | 20 | 2 | `historic` | V1 |
| `timeless` | **Timeless** | ≥ 60 | 4 | 0–15 | 20 | 2 | `timeless` | V1 |
| `alchemy` | **Alchemy** | ≥ 60 | 4 | 0–15 | 20 | 2 | `alchemy` | V1 |
| `explorer` | **Explorer** | ≥ 60 | 4 | 0–15 | 20 | 2 | `explorer` | V1 |
| `peasant` | **Peasant** (comuns + 5 incomuns) | ≥ 60 | 4 | 0–15 | 20 | 2 | — | V2 |
| `artisan` | **Artisan** (comuns e incomuns) | ≥ 60 | 4 | 0–15 | 20 | 2 | — | V2 |

Zonas: `LIBRARY`, `HAND`, `BATTLEFIELD`, `GRAVEYARD`, `EXILE`, `STACK`, `SIDEBOARD`, `COMPANION`.

**Vintage** é o único com lista de **restritas** (máximo 1 cópia, distinto de banida). A Scryfall marca
isso como `legalities.vintage === "restricted"`.

---

## 4. Formatos de comandante

| ID | Formato | Deck | Vida | Jog. | Comandante | `legalityKey` | Fase |
|---|---|---|---|---|---|---|---|
| `commander` | **Commander / EDH** | 100 exatas, singleton | **40** | 2–8 (padrão 4) | 1 criatura lendária | `commander` | MVP |
| `duel_commander` | **Duel Commander** | 100, singleton | **20** | 2 | 1 | `duel` | V1 |
| `commander_1v1` | **Commander 1v1** (MTGO) | 100, singleton | **30** | 2 | 1 | `commander` | V1 |
| `brawl` | **Brawl** | 60, singleton | **25** (1v1) / 30 (multi) | 2–4 | 1 | `brawl` | V1 |
| `historic_brawl` | **Historic Brawl** | 100, singleton | 25 / 30 | 2–4 | 1 | `historicbrawl` | V1 |
| `oathbreaker` | **Oathbreaker** | 60, singleton | **20** | 2–4 | **1 planeswalker + feitiço-assinatura** | `oathbreaker` | V1 |
| `pdh` | **Pauper EDH (PDH)** | 100, singleton, comuns | **40** | 2–6 | 1 incomum | `paupercommander` | V1 |
| `tiny_leaders` | **Tiny Leaders** | 50, singleton, **CMV ≤ 3** | **25** | 2 | 1 | — | V2 |
| `canlander` | **Canadian Highlander** | 100, singleton, **lista de pontos** | 20 | 2 | não | — | V2 |
| `commander_2hg` | **Commander 2HG** | 100, singleton | **30 compartilhada** | 4 (2v2) | 1 por jogador | `commander` | V1 |
| `commander_emperor` | **Commander Emperor** | 100, singleton | 40 | 6 (3v3) | 1 | `commander` | V2 |

**Oathbreaker é o caso mais atípico:** o comandante é um **planeswalker**, e há uma segunda carta
especial — o *feitiço-assinatura*, uma mágica instantânea ou feitiço que também fica na zona de comando
e só pode ser conjurada se o planeswalker estiver no campo. O preset resolve com
`commander: { count: 1, cardType: 'planeswalker', signatureSpell: true }`.

Zonas de comandante: as padrão + `COMMAND`.

---

## 5. Variantes multijogador (estrutura de mesa)

Estas se **combinam** com um formato de deck: "Commander + Two-Headed Giant", "Modern + Emperor".

| ID | Variante | Jogadores | Times | Vida | Máquina extra | Fase |
|---|---|---|---|---|---|---|
| `ffa` | **Free-for-all** | 3–8 | não | do formato | — | MVP |
| `1v1` | **Duelo** | 2 | não | do formato | — | MVP |
| `two_headed_giant` | **Two-Headed Giant** | 4 (2v2) | sim | **30 compartilhada** | vida compartilhada | V1 |
| `emperor` | **Emperor** | 6 (3v3) | sim | 20 ou 40 | times + alcance de influência (visual) | V2 |
| `star` | **Star** | 5 | não | 20 | marcação de adjacência (visual) | V2 |
| `team_unified` | **Team Unified** | 4 ou 6 | sim | do formato | aviso de cartas repetidas entre decks do time | V2 |
| `archenemy` | **Archenemy** | 3–4 (1 vs resto) | sim | 40 no arquinimigo | **baralho de esquemas** | V2 |
| `planechase` | **Planechase** | 2–6 | não | do formato | **baralho planar + dado planar** | V2 |
| `horde` | **Horde Magic** | 1–4 cooperativo | sim | do formato | **baralho da horda automatizado** | V2 |

### 5.1 Vida compartilhada quebra o modelo de `Player`

O `Player` atual tem `life` individual. Two-Headed Giant precisa de **um total por time**.

```ts
// solução: a vida passa a viver no time quando o formato tem times
export class Team extends Schema {
  @type('string') id!: string;
  @type('number') life = 30;
  @type('number') poison = 0;
  @type({ map: 'number' }) counters = new MapSchema<number>();
}

export class RoomState extends Schema {
  @type({ map: Team }) teams = new MapSchema<Team>();   // vazio quando não há times
  // Player.teamId aponta para cá; Player.life é ignorado se teams estiver populado
}
```

**Regra:** `format.teams.sharedLife === true` → a UI e as intenções de vida operam no `Team`; caso
contrário, no `Player`. Uma única bifurcação, resolvida por dado.

**Alcance de influência (Emperor)** é apenas **marcação visual**: o sistema desenha quem está ao
alcance de quem e não impede nada (`RN01`).

---

## 6. Formatos limitados (exigem motor de draft)

| ID | Formato | Jogadores | Mecânica | Fase |
|---|---|---|---|---|
| `sealed` | **Sealed Deck** | 1–8 | Abrir 6 pacotes, montar deck ≥ 40 | **V2** |
| `booster_draft` | **Booster Draft** | 4–8 | 3 pacotes, escolher 1 e passar | V3 |
| `cube_draft` | **Cube Draft** | 4–8 | Pacotes gerados de uma lista de cubo | V3 |
| `chaos_draft` | **Chaos Draft** | 4–8 | Pacotes de coleções diferentes | V3 |
| `rochester` | **Rochester Draft** | 4–8 | Pacote aberto e revelado, escolha em ordem | V3 |
| `winston` | **Winston Draft** | 2 | Três pilhas, pegar ou passar | V3 |
| `winchester` | **Winchester Draft** | 2 | Quatro pilhas visíveis | V3 |
| `grid` | **Grid Draft** | 2 | Grade 3×3, escolher linha ou coluna | V3 |
| `solomon` | **Solomon Draft** | 2 | Dividir e escolher | V3 |
| `team_draft` | **Team Draft** | 4 ou 6 | Draft em times | V3 |
| `jumpstart` | **Jumpstart** | 2–4 | Dois pacotes temáticos de 20, sem escolha | **V2** |

### 6.1 Por que draft é V3 e Sealed/Jumpstart são V2

**Sealed** e **Jumpstart** não precisam de motor de draft — precisam apenas de **geração de pacote**:
sortear N cartas de uma coleção respeitando a distribuição de raridade. Isso é uma função pura sobre
dados da Scryfall (`GET /cards/search?q=set:xyz`) e cabe numa tarde.

**Draft** precisa de: sessão persistente entre jogadores, pacotes passando em círculo, cronômetro por
escolha, tratamento de desconexão no meio do draft (o que acontece com o pacote dele?), e a transição
draft → construção de deck → partida. É um **subsistema com estado próprio**, comparável em tamanho ao
motor de mesa. Daí a fase separada.

### 6.2 Cubo é só uma lista

Um cubo é uma decklist grande (360–720 cartas). Reaproveita o importador existente (`F02`) com um
`board_type` novo: `CUBE`. Custa quase nada — o que custa é o draft que o consome.

---

## 7. Formatos casuais e nativos do sandbox

| ID | Formato | Deck | Vida | Jog. | Fase |
|---|---|---|---|---|---|
| **`freeform`** | **Mesa de cozinha — zero validação** | qualquer | configurável | 1–8 | **MVP** |
| `singleton` | Highlander genérico (60 singleton) | ≥ 60, singleton | 20 | 2–8 | V1 |
| `type_4` | **Type 4** (mana infinito, sem terrenos) | singleton | 20 | 2–8 | V2 |
| `battle_box` | **Battle Box / Danger Room** (baralho compartilhado) | 1 baralho comum | 20 | 2–4 | V2 |
| `momir` | **Momir Basic** | 60 terrenos básicos + vanguard | 20 | 2 | V2 |
| `vanguard` | **Vanguard** | ≥ 60 | modificada pela carta vanguard | 2–4 | V2 |
| `solo` | **Playtest solo** | qualquer | 40 | **1** | **MVP** |

### 7.1 `solo` merece destaque

Jogar sozinho é o caso de uso nº 1 declarado em [documento_de_visao_do_projeto.md](documento_de_visao_do_projeto.md) §3
("O Testador — vale a pena comprar?"). É uma sala de **um jogador**, e o `RN03` original (mínimo
implícito de mesa cheia) não previa isso. Custo: zero — é só permitir `players.min = 1`.

### 7.2 `momir` e `vanguard` compartilham máquina

Ambos usam uma **carta de vanguard** que altera mão inicial e vida. Momir adiciona a habilidade de
descartar uma carta e criar uma ficha de criatura aleatória com aquele custo de mana — o que é
`INTENT_RANDOM_CARD` filtrado por `cmc` na Scryfall (ação 122 de `DOC-036`). Barato.

---

## 8. Baralhos extras e zonas por formato

| Zona / baralho | Formatos | Comportamento | Fase |
|---|---|---|---|
| `LIBRARY`, `HAND`, `BATTLEFIELD`, `GRAVEYARD`, `EXILE` | **todos** | Padrão | MVP |
| `STACK` | todos | Área visual de conjuração (`DOC-036` ação 129) | V1 |
| `SIDEBOARD` | construídos, limitados | Acessível na partida (wishboard) | V1 |
| `COMMAND` | Commander, Brawl, Oathbreaker, PDH, Tiny Leaders | Comandante + taxa | MVP |
| `COMPANION` | construídos | Companheiro | V1 |
| `PLANAR` | Planechase | Baralho de planos + dado planar | V2 |
| `SCHEME` | Archenemy | Baralho de esquemas do arquinimigo | V2 |
| `VANGUARD` | Vanguard, Momir | Carta que modifica o início | V2 |
| `ATTRACTION` | Unfinity | ≥ 10 atrações; "visitar" abre uma | V2 |
| `CONTRAPTION` | Unstable | ≥ 15 engenhocas; "montar" | V2 |
| `STICKER` | Unfinity | 3 folhas de adesivos | V2 |
| `HORDE` | Horde Magic | Baralho que joga sozinho | V2 |
| `CUBE` | Cube Draft | Reservatório de cartas do cubo | V3 |

**Nada disso é código novo no motor.** Uma zona é uma entrada em `zoneOrder` e uma regra de
visibilidade — o modelo de `DOC-032` §2 já suporta. O preset diz quais zonas existem; a UI desenha só
essas.

---

## 9. Impacto nas regras existentes

| Regra atual | Situação | Nova redação |
|---|---|---|
| **`RN03` — máximo 4 jogadores** | ⚠️ **Precisa mudar** | O limite passa a vir do preset: `format.players.max`, de **1 a 8**. O teto absoluto do sistema é 8 (Emperor 3v3 usa 6) |
| `RN05` — tolerância na importação | ✅ Vale igual | Os avisos passam a ser calculados pelo preset em vez de fixos no Commander |
| `RN01` — sandbox | ✅ Reforçada | Nenhum formato ganha validação impositiva. Alcance de influência, restritas e lista de pontos são **avisos** |
| `RN02`, `RN13` — visibilidade | ✅ Vale igual | Zonas novas entram na tabela de `DOC-032` §4.1 |
| `RN06` — aleatoriedade no servidor | ✅ Reforçada | Geração de pacote (Sealed, Jumpstart) e dado planar também usam CSPRNG |

### 9.1 Impacto no modelo de dados

`Deck.format` é hoje um `ENUM` com 6 valores. Com 40+ formatos e novos surgindo, enum vira migração
a cada coleção.

```sql
-- ANTES
format DeckFormat  -- ENUM: COMMANDER | STANDARD | MODERN | LEGACY | PAUPER | FREEFORM

-- DEPOIS
format_id  VARCHAR(32) NOT NULL DEFAULT 'commander'   -- referencia FormatPreset.id
```

Os presets vivem em `packages/shared-types/src/formats/*.json`, versionados com o código — **não** no
banco. Motivo: são configuração de produto, não dado de usuário; precisam de revisão em PR; e um
formato novo não deve exigir migração.

`DeckCard.board_type` ganha valores: `CUBE`, `PLANAR`, `SCHEME`, `ATTRACTION`, `CONTRAPTION`,
`STICKER`, `VANGUARD`, `SIGNATURE_SPELL`.

### 9.2 Impacto na validação de deck

A função de validação passa a ser genérica, dirigida pelo preset:

```ts
function validarDeck(deck: Deck, preset: FormatPreset): Aviso[] {
  const avisos: Aviso[] = [];
  const total = deck.cards.reduce((s, c) => s + c.quantity, 0);

  if (preset.deck.exactSize && total !== preset.deck.exactSize)
    avisos.push({ code: 'COUNT_MISMATCH', expected: preset.deck.exactSize, actual: total });
  if (preset.deck.minSize && total < preset.deck.minSize)
    avisos.push({ code: 'COUNT_BELOW_MIN', expected: preset.deck.minSize, actual: total });

  if (preset.deck.singleton) { /* aponta duplicatas não-básicas */ }
  if (preset.deck.rarityCeiling) { /* aponta raridade acima do teto */ }
  if (preset.deck.maxManaValue) { /* aponta CMV acima do limite */ }
  if (preset.deck.legalityKey) { /* usa legalities da Scryfall: banned / restricted */ }
  if (preset.commander?.enforceColorIdentity) { /* aponta fora da identidade */ }

  return avisos;   // SEMPRE avisos — nunca bloqueio (RN05, RN01)
}
```

Uma função, 40 formatos. É o retorno da tese da §1.

---

## 10. Roadmap de formatos

| Fase | Formatos entregues | Custo |
|---|---|---|
| **MVP** | `freeform`, `solo`, `commander`, `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, `ffa`, `1v1` | Baixo — presets + validação genérica |
| **V1** | `duel_commander`, `commander_1v1`, `brawl`, `historic_brawl`, `oathbreaker`, `pdh`, `premodern`, `oldschool`, `historic`, `timeless`, `alchemy`, `explorer`, `singleton`, `two_headed_giant`, `commander_2hg` | Médio — vida compartilhada e times |
| **V2** | `sealed`, `jumpstart`, `planechase`, `archenemy`, `horde`, `emperor`, `star`, `team_unified`, `tiny_leaders`, `canlander`, `type_4`, `battle_box`, `momir`, `vanguard`, `peasant`, `artisan`, Unfinity/Unstable | Médio — zonas e baralhos extras |
| **V3** | Todos os formatos de draft | **Alto** — motor de draft |

**Total: 45 formatos e variantes.** Dos quais **11 no MVP** por praticamente o mesmo custo do
Commander sozinho — porque a validação e o provisionamento já são dirigidos por preset.

---

## 11. Exemplos de preset

```json
// commander.json
{
  "id": "commander", "name": "Commander", "category": "COMMANDER", "status": "STABLE",
  "players": { "min": 1, "max": 8, "default": 4 },
  "teams": null,
  "startingLife": 40, "startingHandSize": 7, "maxHandSize": 7,
  "deck": {
    "exactSize": 100, "minSize": null, "maxSize": null,
    "singleton": true, "maxCopies": 1, "sideboard": null,
    "rarityCeiling": null, "maxManaValue": null,
    "legalityKey": "commander", "pointsList": null
  },
  "commander": {
    "count": 1, "cardType": "creature", "signatureSpell": false,
    "enforceColorIdentity": true, "tax": true
  },
  "zones": ["LIBRARY","HAND","BATTLEFIELD","GRAVEYARD","EXILE","COMMAND","STACK"],
  "extraDecks": [], "requiresDraftEngine": false
}
```

```json
// freeform.json — o mais permissivo possível
{
  "id": "freeform", "name": "Mesa de Cozinha", "category": "CASUAL", "status": "STABLE",
  "players": { "min": 1, "max": 8, "default": 4 },
  "teams": null,
  "startingLife": 20, "startingHandSize": 7, "maxHandSize": null,
  "deck": {
    "exactSize": null, "minSize": null, "maxSize": null,
    "singleton": false, "maxCopies": 99, "sideboard": { "min": 0, "max": 99 },
    "rarityCeiling": null, "maxManaValue": null,
    "legalityKey": null, "pointsList": null
  },
  "commander": null,
  "zones": ["LIBRARY","HAND","BATTLEFIELD","GRAVEYARD","EXILE","COMMAND","STACK","SIDEBOARD"],
  "extraDecks": [], "requiresDraftEngine": false
}
```

```json
// two_headed_giant.json — variante com vida compartilhada
{
  "id": "two_headed_giant", "name": "Two-Headed Giant", "category": "VARIANT", "status": "BETA",
  "players": { "min": 4, "max": 4, "default": 4 },
  "teams": { "size": 2, "sharedLife": true },
  "startingLife": 30, "startingHandSize": 7, "maxHandSize": 7,
  "deck": {
    "exactSize": null, "minSize": 60, "maxSize": null,
    "singleton": false, "maxCopies": 4, "sideboard": { "min": 0, "max": 15 },
    "rarityCeiling": null, "maxManaValue": null, "legalityKey": "modern", "pointsList": null
  },
  "commander": null,
  "zones": ["LIBRARY","HAND","BATTLEFIELD","GRAVEYARD","EXILE","STACK","SIDEBOARD"],
  "extraDecks": [], "requiresDraftEngine": false
}
```

```json
// oathbreaker.json — comandante planeswalker + feitiço-assinatura
{
  "id": "oathbreaker", "name": "Oathbreaker", "category": "COMMANDER", "status": "BETA",
  "players": { "min": 2, "max": 4, "default": 4 },
  "teams": null,
  "startingLife": 20, "startingHandSize": 7, "maxHandSize": 7,
  "deck": {
    "exactSize": 60, "minSize": null, "maxSize": null,
    "singleton": true, "maxCopies": 1, "sideboard": null,
    "rarityCeiling": null, "maxManaValue": null,
    "legalityKey": "oathbreaker", "pointsList": null
  },
  "commander": {
    "count": 1, "cardType": "planeswalker", "signatureSpell": true,
    "enforceColorIdentity": true, "tax": true
  },
  "zones": ["LIBRARY","HAND","BATTLEFIELD","GRAVEYARD","EXILE","COMMAND","STACK"],
  "extraDecks": [], "requiresDraftEngine": false
}
```

---

## 12. Checklist de conformidade

- [ ] `FormatPreset` em `packages/shared-types`, presets como JSON versionado.
- [ ] `validarDeck(deck, preset)` genérica — **zero** `if (formato === ...)` no motor.
- [ ] `Deck.format` migrado de `ENUM` para `VARCHAR(32)` referenciando `preset.id`.
- [ ] `RN03` atualizada: limite de jogadores vem do preset, de 1 a 8.
- [ ] `players.min = 1` permitido (playtest solo).
- [ ] `Team` no `Schema`, usado só quando `teams.sharedLife`.
- [ ] Zonas do preset determinam o layout da mesa; zona ausente não é renderizada.
- [ ] Zonas novas incluídas na tabela de visibilidade (`DOC-032` §4.1) — **falha fechada** por padrão.
- [ ] `legalityKey` lido da Scryfall — **nenhuma banlist mantida por nós**.
- [ ] Vintage tratando `restricted` além de `banned`.
- [ ] Validação sempre em modo aviso (`RN05`, `RN01`).
- [ ] `freeform` como fallback quando o formato é desconhecido.
- [ ] Geração de pacote (Sealed/Jumpstart) usando CSPRNG (`RN06`).
