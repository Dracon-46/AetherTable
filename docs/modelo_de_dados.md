# Modelo de Dados (Database Schema)

| Campo | Valor |
|---|---|
| **ID** | `DOC-023` |
| **Versão** | 1.1 |
| **Status** | Estável |
| **Última revisão** | 2026-08-20 |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_da_api_backend.md](especificacao_da_api_backend.md) · [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) · [seguranca_e_privacidade.md](seguranca_e_privacidade.md) |

---

## 1. Estratégia de banco

**PostgreSQL 16** para consistência relacional e transações ACID, mapeado via **Prisma ORM**.

### 1.1 O que vive onde

| Dado | Armazenamento | Durabilidade | Justificativa |
|---|---|---|---|
| Usuários, decks, itens de deck | PostgreSQL | **Durável** | Relacional, transacional, precisa sobreviver |
| `card_cache` | PostgreSQL | Derivável | Reconstruível a partir da Scryfall |
| Estado de partida (`RoomState`) | RAM do game node | **Volátil** | Muta dezenas de vezes por segundo (`ADR-006`, `RN12`) |
| Presença de sala, `sessionId` | Redis | Volátil, TTL curto | Coordenação entre nós |
| *Rate limit* | Redis | Volátil | Contadores efêmeros |
| Imagens de carta | CDN da Scryfall | Cache | Nunca hospedamos artes |

### 1.2 Princípio central

> **Não armazenamos textos, regras nem imagens de carta.** Guardamos estritamente o `scryfall_id`.
> O frontend hidrata os dados a partir da Scryfall em runtime ou do `card_cache`.

Motivos: (a) a base de cartas do MTG tem 25.000+ *oracle cards* e 90.000+ *printings*, e cresce a cada
dois meses; (b) manter cópia significaria manter sincronização; (c) evita qualquer discussão sobre
redistribuição de conteúdo protegido.

---

## 2. Diagrama de entidades

```
┌────────────────────┐
│       User         │
│────────────────────│
│ id (PK)            │
│ email (unique)     │
│ username (unique)  │
│ password_hash?     │
│ avatar_url?        │
│ role               │
│ created_at         │
└─────┬────────┬─────┘
      │ 1:N    │ 1:1
      │        └──────────────┐
      ▼                       ▼
┌────────────────────┐  ┌─────────────────────┐
│       Deck         │  │  UserPreference     │
│────────────────────│  │─────────────────────│
│ id (PK)            │  │ user_id (PK,FK)     │
│ user_id (FK)       │  │ keybindings (JSONB) │
│ name               │  │ theme               │
│ commander_id?      │  │ playmat_url?        │
│ format             │  │ voice_mode          │
│ is_public          │  │ master_volume       │
│ is_favorite        │  └─────────────────────┘
│ card_count         │
│ created_at         │        ┌──────────────────────┐
│ updated_at         │        │      Account         │
└─────┬──────────────┘        │──────────────────────│
      │ 1:N                   │ id (PK)              │
      ▼                       │ user_id (FK)         │
┌────────────────────┐        │ provider             │
│     DeckCard       │        │ provider_account_id  │
│────────────────────│        └──────────────────────┘
│ id (PK)            │                 ▲ N:1
│ deck_id (FK)       │                 └──── User
│ scryfall_id        │
│ quantity           │        ┌──────────────────────┐
│ is_commander       │        │       Block          │
│ board_type         │        │──────────────────────│
└─────┬──────────────┘        │ blocker_id (FK)      │
      │ N:1 (lógico,          │ blocked_id (FK)      │
      │  sem FK forte)        │ created_at           │
      ▼                       └──────────────────────┘
┌────────────────────┐
│     CardCache      │        ┌──────────────────────┐
│────────────────────│        │       Report         │
│ scryfall_id (PK)   │        │──────────────────────│
│ oracle_id          │        │ id (PK)              │
│ name               │        │ reporter_id (FK)     │
│ set_code           │        │ reported_id (FK)     │
│ legal_commander    │        │ reason · status      │
│ image_small        │        │ created_at           │
│ faces (JSONB)      │        └──────────────────────┘
│ fetched_at         │
└────────────────────┘        ┌──────────────────────┐
                              │    MatchSummary      │
                              │──────────────────────│
                              │ id (PK)              │
                              │ room_code            │
                              │ player_count         │
                              │ duration_seconds     │
                              │ ended_at             │
                              └──────────────────────┘

┌────────────────────┐        ┌──────────────────────┐
│    CosmeticItem    │        │    UserCosmetics     │
│────────────────────│        │──────────────────────│
│ id (PK)            │        │ id (PK)              │
│ type (enum)        │        │ user_id (FK)         │
│ name               │        │ cosmetic_id (FK)     │
│ resource_url       │        │ acquired_at          │
│ min_tier           │        └──────────────────────┘
└────────────────────┘
```

---

## 3. Dicionário de dados

### 3.1 `User`

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK, default `gen_random_uuid()` | Identificador |
| `email` | `VARCHAR(255)` | **Unique**, indexado, not null | Login e contato |
| `username` | `VARCHAR(32)` | **Unique**, indexado, not null | Nome público. `^[a-zA-Z0-9_]{3,32}$` |
| `display_name` | `VARCHAR(48)` | nullable | Nome exibido na mesa; cai para `username` |
| `password_hash` | `VARCHAR(255)` | **nullable** | Argon2id. Nulo quando a conta é exclusivamente OAuth |
| `avatar_url` | `TEXT` | nullable | URL do provedor ou upload |
| `role` | `ENUM` | `USER` \| `MOD` \| `ADMIN`, default `USER` | Autorização |
| `email_verified_at` | `TIMESTAMPTZ` | nullable | — |
| `last_seen_at` | `TIMESTAMPTZ` | nullable | Atualizado no login |
| `deleted_at` | `TIMESTAMPTZ` | nullable | *Soft delete* para LGPD (§7) |
| `created_at` | `TIMESTAMPTZ` | not null, default `now()` | — |
| `updated_at` | `TIMESTAMPTZ` | not null | — |

**Índices:** `email` (unique), `username` (unique), `deleted_at` (parcial `WHERE deleted_at IS NULL`).

### 3.2 `Account` — vínculo OAuth

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK | — |
| `user_id` | `UUID` | FK → `User`, `ON DELETE CASCADE` | Dono |
| `provider` | `ENUM` | `GOOGLE` \| `DISCORD` | Provedor |
| `provider_account_id` | `VARCHAR(255)` | not null | ID no provedor |
| `created_at` | `TIMESTAMPTZ` | not null | — |

**Restrição:** `UNIQUE (provider, provider_account_id)`. Permite vincular Google **e** Discord à mesma
conta sem duplicar usuário (`CDU01` A1).

> **Não armazenamos** *access token* nem *refresh token* do provedor. Usamos OAuth apenas para
> identificar, nunca para agir em nome do usuário (`RN11`).

### 3.3 `Deck`

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK | — |
| `user_id` | `UUID` | FK → `User`, `ON DELETE CASCADE`, indexado | Dono |
| `name` | `VARCHAR(80)` | not null | Nome do deck |
| `description` | `TEXT` | nullable, máx. 2.000 | Anotações |
| `commander_id` | `VARCHAR(36)` | nullable | `scryfall_id` do comandante |
| `partner_id` | `VARCHAR(36)` | nullable | Segundo comandante (Partner/Background) |
| `format_id` | `VARCHAR(32)` | not null, default `commander` | Referencia `FormatPreset.id`. **Não é enum** — há 45+ formatos e novos surgem a cada coleção. Presets vivem versionados no código, não no banco (`DOC-037` §9.1) |
| `is_public` | `BOOLEAN` | default `false` | Compartilhável por link |
| `is_favorite` | `BOOLEAN` | default `false` | Favorito do usuário |
| `card_count` | `INTEGER` | default 0 | **Desnormalizado** — soma de `quantity`, para listar sem `JOIN` |
| `color_identity` | `TEXT[]` | default `{}` | Cache de identidade de cor, derivado do comandante |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | not null | — |

**Índices:** `(user_id, updated_at DESC)` para a listagem "Meus Decks"; `(is_public)` parcial para
decks públicos.

**Nota sobre `card_count`:** desnormalização deliberada. A listagem de decks é a tela mais visitada;
somar `quantity` de `DeckCard` a cada carregamento é desperdício. Atualizado na mesma transação que
altera as cartas.

### 3.4 `DeckCard` — itens do deck

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `id` | `UUID` | PK | — |
| `deck_id` | `UUID` | FK → `Deck`, `ON DELETE CASCADE`, indexado | Deck |
| `scryfall_id` | `VARCHAR(36)` | not null, indexado | **Referência absoluta de impressão** — define arte, edição e idioma |
| `quantity` | `INTEGER` | not null, `CHECK (quantity BETWEEN 1 AND 99)` | Quantidade |
| `is_commander` | `BOOLEAN` | default `false` | Marca comandante |
| `board_type` | `ENUM` | `MAIN` \| `SIDEBOARD` \| `COMMANDER` \| `MAYBEBOARD` \| `SIGNATURE_SPELL` \| `CUBE` \| `PLANAR` \| `SCHEME` \| `VANGUARD` \| `ATTRACTION` \| `CONTRAPTION` \| `STICKER`, default `MAIN` | Seção. Os valores extras atendem Oathbreaker, cubo, Planechase, Archenemy, Vanguard e Un-sets (`DOC-037` §8) |
| `sort_order` | `INTEGER` | default 0 | Ordem preferida do usuário |

**Restrição:** `UNIQUE (deck_id, scryfall_id, board_type)` — uma linha por impressão por seção;
quantidades vão em `quantity`, não em linhas repetidas.

**É exatamente isto que `FR-04` exige:** apenas `scryfall_id`, `quantity`, `is_commander` e
`board_type`. Nome, texto e imagem **nunca** aqui.

### 3.5 `CardCache` — cache derivável

Ver [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) §6.1 para o DDL completo.
Resumo das colunas: `scryfall_id` (PK), `oracle_id`, `name`, `set_code`, `collector_num`, `lang`,
`cmc`, `type_line`, `mana_cost`, `color_identity`, `legal_commander`, `layout`, `image_small`,
`image_normal`, `faces` (JSONB), `fetched_at`.

**Característica importante:** esta tabela é **descartável**. Um `TRUNCATE` não perde nada de valor —
o job de bulk data a reconstrói. Por isso ela não tem FK apontando para ela e não participa de
transações críticas.

### 3.6 `UserPreference`

| Coluna | Tipo | Restrições | Descrição |
|---|---|---|---|
| `user_id` | `UUID` | PK e FK → `User`, `ON DELETE CASCADE` | 1:1 com usuário |
| `keybindings` | `JSONB` | default `{}` | Mapa ação → tecla (`F39`) |
| `theme` | `ENUM` | `DARK` \| `LIGHT` \| `SYSTEM`, default `DARK` | Tema |
| `active_playmat_id` | `UUID` | nullable, FK → `CosmeticItem` | Playmat equipado (`F40`) |
| `active_sleeve_id` | `UUID` | nullable, FK → `CosmeticItem` | Protetor de carta equipado |
| `active_border_id` | `UUID` | nullable, FK → `CosmeticItem` | Borda de perfil equipada |
| `active_title_id` | `UUID` | nullable, FK → `CosmeticItem` | Título de chat equipado |
| `voice_mode` | `ENUM` | `VAD` \| `PTT`, default `VAD` | Modo de voz |
| `ptt_key` | `VARCHAR(24)` | nullable | Tecla de Push-to-Talk |
| `master_volume` | `SMALLINT` | default 100, `CHECK (0..100)` | Volume geral |
| `language` | `VARCHAR(8)` | default `pt-BR` | i18n (V2) |

**JSONB para `keybindings`:** o conjunto de ações mapeáveis muda a cada versão. Normalizar isso em
tabela geraria migração a cada atalho novo, sem nenhum ganho de consulta — nunca filtramos por atalho.

### 3.7 `Block` e `Report` — moderação (`RF03`, `F36`)

**`Block`**

| Coluna | Tipo | Restrições |
|---|---|---|
| `blocker_id` | `UUID` | FK → `User`, PK composta |
| `blocked_id` | `UUID` | FK → `User`, PK composta |
| `created_at` | `TIMESTAMPTZ` | not null |

PK composta `(blocker_id, blocked_id)`; `CHECK (blocker_id <> blocked_id)`.

**`Report`**

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `UUID` | PK |
| `reporter_id` | `UUID` | FK → `User` |
| `reported_id` | `UUID` | FK → `User`, indexado |
| `room_code` | `VARCHAR(6)` | nullable — contexto |
| `reason` | `ENUM` | `HARASSMENT` \| `CHEATING` \| `SPAM` \| `HATE_SPEECH` \| `OTHER` |
| `details` | `TEXT` | nullable, máx. 1.000 |
| `status` | `ENUM` | `OPEN` \| `REVIEWING` \| `RESOLVED` \| `DISMISSED`, default `OPEN` |
| `created_at` | `TIMESTAMPTZ` | not null |

### 3.8 `MatchSummary` — estatística agregada

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | `UUID` | PK |
| `room_code` | `VARCHAR(6)` | Código da sala (não identifica jogadores) |
| `player_count` | `SMALLINT` | 1–4 |
| `duration_seconds` | `INTEGER` | Duração |
| `ended_at` | `TIMESTAMPTZ` | Fim |

**Deliberadamente pobre.** Não guarda estado de jogo, jogadas, decks nem quem ganhou — apenas o
suficiente para "partidas jogadas" no perfil (`RF02`) e para métricas de produto. Consistente com
`RN12` e `ADR-006`.

Tabela de ligação `MatchParticipant (match_id, user_id)` existe para alimentar o contador do perfil e
é a única a associar usuário e partida.

### 3.9 `CosmeticItem` e `UserCosmetics` — Inventário e Monetização (`DOC-060`)

**`CosmeticItem`** (Catálogo global gerenciado no painel Admin)

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `UUID` | PK |
| `type` | `ENUM` | `PLAYMAT` \| `SLEEVE` \| `BORDER` \| `TITLE` |
| `name` | `VARCHAR(64)` | not null |
| `resource_url` | `TEXT` | nullable (ex: URL da imagem ou classe CSS) |
| `min_tier` | `INTEGER` | default 0 (nível de apoiador necessário) |
| `is_active` | `BOOLEAN` | default true |

**`UserCosmetics`** (O que o usuário destravou)

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `User`, indexado |
| `cosmetic_id` | `UUID` | FK → `CosmeticItem` |
| `acquired_at` | `TIMESTAMPTZ` | not null |

---

## 4. Schema Prisma (referência)

```prisma
// apps/backend-core/prisma/schema.prisma

generator client { provider = "prisma-client-js" }
datasource db    { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role       { USER MOD ADMIN }
enum Provider   { GOOGLE DISCORD }
// formato NAO e enum: ver DOC-037 §9.1 — e um VARCHAR que referencia FormatPreset.id
enum BoardType  { MAIN SIDEBOARD COMMANDER MAYBEBOARD SIGNATURE_SPELL CUBE PLANAR SCHEME VANGUARD ATTRACTION CONTRAPTION STICKER }
enum Theme      { DARK LIGHT SYSTEM }
enum VoiceMode  { VAD PTT }
enum CosmeticType { PLAYMAT SLEEVE BORDER TITLE }

model User {
  id              String    @id @default(uuid()) @db.Uuid
  email           String    @unique @db.VarChar(255)
  username        String    @unique @db.VarChar(32)
  displayName     String?   @map("display_name") @db.VarChar(48)
  passwordHash    String?   @map("password_hash")
  avatarUrl       String?   @map("avatar_url")
  role            Role      @default(USER)
  emailVerifiedAt DateTime? @map("email_verified_at")
  lastSeenAt      DateTime? @map("last_seen_at")
  deletedAt       DateTime? @map("deleted_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt      @map("updated_at")

  decks       Deck[]
  accounts    Account[]
  preference  UserPreference?
  blocksMade  Block[] @relation("blocker")
  blocksGot   Block[] @relation("blocked")

  @@index([deletedAt])
  @@map("users")
}

model Deck {
  id            String     @id @default(uuid()) @db.Uuid
  userId        String     @map("user_id") @db.Uuid
  name          String     @db.VarChar(80)
  description   String?
  commanderId   String?    @map("commander_id") @db.VarChar(36)
  partnerId     String?    @map("partner_id")   @db.VarChar(36)
  formatId      String     @default("commander") @map("format_id") @db.VarChar(32)
  isPublic      Boolean    @default(false) @map("is_public")
  isFavorite    Boolean    @default(false) @map("is_favorite")
  cardCount     Int        @default(0)     @map("card_count")
  colorIdentity String[]   @default([])    @map("color_identity")
  createdAt     DateTime   @default(now()) @map("created_at")
  updatedAt     DateTime   @updatedAt      @map("updated_at")

  user  User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  cards DeckCard[]

  @@index([userId, updatedAt(sort: Desc)])
  @@map("decks")
}

model DeckCard {
  id          String    @id @default(uuid()) @db.Uuid
  deckId      String    @map("deck_id") @db.Uuid
  scryfallId  String    @map("scryfall_id") @db.VarChar(36)
  quantity    Int       @default(1)
  isCommander Boolean   @default(false) @map("is_commander")
  boardType   BoardType @default(MAIN)  @map("board_type")
  sortOrder   Int       @default(0)     @map("sort_order")

  deck Deck @relation(fields: [deckId], references: [id], onDelete: Cascade)

  @@unique([deckId, scryfallId, boardType])
  @@index([deckId])
  @@index([scryfallId])
  @@map("deck_cards")
}
```

*(`Account`, `UserPreference`, `CardCache`, `Block`, `Report`, `MatchSummary` seguem o mesmo padrão de
mapeamento `snake_case` no banco e `camelCase` no cliente.)*

---

## 5. Consultas críticas e seus índices

| Consulta | Frequência | Índice que a atende |
|---|---|---|
| Listar decks do usuário, mais recentes primeiro | **Muito alta** | `decks (user_id, updated_at DESC)` |
| Carregar deck completo para a sala | Alta | `deck_cards (deck_id)` |
| Hidratar cartas de um deck a partir do cache | Alta | `card_cache (scryfall_id)` PK |
| Buscar carta por nome no cache local | Média | `card_cache (lower(name))` |
| Verificar bloqueio ao entrar em sala | Média | `blocks (blocker_id, blocked_id)` PK |
| Login por e-mail | Média | `users (email)` unique |
| Contar partidas do perfil | Baixa | `match_participants (user_id)` |

**Antipadrão a evitar:** carregar `DeckCard` e depois consultar `CardCache` uma vez por carta (N+1).
O correto é um `IN` único com todos os `scryfall_id` do deck.

---

## 6. Migrações

| Regra | Detalhe |
|---|---|
| Ferramenta | `prisma migrate` — sempre versionado, nunca `db push` em produção |
| Nomenclatura | `YYYYMMDDHHMMSS_descricao_em_snake_case` |
| Reversibilidade | Toda migração destrutiva vem em duas etapas: (1) adiciona novo + escreve nos dois; (2) remove o antigo, em release posterior |
| Coluna nova | Sempre `nullable` ou com `DEFAULT` — nunca `NOT NULL` sem default em tabela populada |
| Índice em tabela grande | `CREATE INDEX CONCURRENTLY`, fora da transação da migração |
| Seed | `prisma/seed.ts` cria usuário de teste e 2 decks de exemplo — **apenas** em dev/staging |

---

## 7. Retenção, privacidade e LGPD

| Dado | Retenção | Base |
|---|---|---|
| Conta e decks | Enquanto a conta existir | Execução do serviço |
| Conta excluída | *Soft delete* imediato; expurgo físico em **30 dias** | `RF13`, LGPD art. 18 |
| `card_cache` | Indefinida (dado público, não pessoal) | — |
| `MatchSummary` | 12 meses | Métrica de produto |
| `Report` | 24 meses após resolução | Moderação e auditoria |
| Log de acesso (IP) | 6 meses | Segurança |
| Chat de sala | **Não persistido** | `RN11` |
| Áudio de voz | **Nunca gravado** | `RN11` |

### 7.1 Exclusão de conta

```
Usuário pede exclusão
  ├─ users.deleted_at = now()            ← imediato, conta fica inacessível
  ├─ todas as sessões invalidadas        ← FR-19
  ├─ decks ficam inacessíveis
  └─ job diário: após 30 dias
       ├─ DELETE users (CASCADE derruba decks, deck_cards, accounts, preferences, blocks)
       └─ MatchParticipant.user_id → NULL   ← preserva a estatística agregada, anonimizada
```

`MatchSummary` sobrevive porque não contém dado pessoal — apenas contagem e duração.

### 7.2 Dados que o sistema deliberadamente **não** guarda

- Senha de provedor OAuth.
- *Access/refresh token* de provedor OAuth.
- Dados de pagamento (a doação acontece na plataforma do Patreon, fora daqui).
- Conteúdo de chat.
- Áudio.
- Estado ou histórico de jogadas (`RN12`).
- Endereço IP associado permanentemente ao usuário.

---

## 8. Backup e recuperação

| Item | Política |
|---|---|
| *Full backup* | Diário, retenção de 30 dias |
| WAL / PITR | Contínuo, janela de 7 dias |
| Teste de restauração | **Mensal**, em ambiente isolado — backup não testado não é backup |
| RPO | ≤ 5 minutos |
| RTO | ≤ 1 hora |
| `card_cache` | Não precisa de backup (reconstruível) |
| Redis | Não precisa de backup (volátil por design) |
