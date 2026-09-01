# Integrações Externas — Scryfall API

| Campo                       | Valor                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-035`                                                                                                                                                                                                                         |
| **Versão**                  | 1.0                                                                                                                                                                                                                               |
| **Status**                  | Estável                                                                                                                                                                                                                           |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                        |
| **Documentos relacionados** | [readme.md](readme.md) · [especificacao_da_api_backend.md](especificacao_da_api_backend.md) · [modelo_de_dados.md](modelo_de_dados.md) · [especificacao_tecnica_do_frontend_ui_ux.md](especificacao_tecnica_do_frontend_ui_ux.md) |

---

## 1. Papel da Scryfall na arquitetura

A Scryfall é a **única fonte de dados de carta** do AetherTable. O projeto não mantém
banco próprio de cartas: armazenamos apenas o `scryfall_id` (UUID de _printing_) e hidratamos
nome, imagem, custo, tipo e legalidade em runtime.

Consequência arquitetural direta: **a Scryfall é uma dependência externa crítica**. Se ela cai,
o Deckbuilder para de importar novos decks, mas **partidas em andamento continuam funcionando**,
porque o estado da mesa referencia apenas UUIDs e o cliente serve imagens do cache local.

```
[ Deckbuilder (browser) ] ──► [ Backend Core ] ──► [ Scryfall API ]
                                     │                    │
                                     ▼                    │
                              [ PostgreSQL ]              │
                              (só scryfall_id)            │
                                                          ▼
[ Game Board (Canvas) ] ◄──────────────────────── [ Imagens via CDN + Service Worker ]
```

**Regra de ouro:** chamadas de _busca e resolução_ (texto → UUID) passam pelo backend, para
centralizar cache e respeitar rate limit. Chamadas de _imagem_ vão direto do browser para a CDN
da Scryfall, para não gastar banda do nosso servidor.

---

## 2. Endpoints utilizados

Base: `https://api.scryfall.com`

| Uso no produto                   | Método e rota                               | Quem chama                               | Observação                                                                          |
| -------------------------------- | ------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Busca com filtros no Deckbuilder | `GET /cards/search?q=...`                   | Backend                                  | Sintaxe de query da Scryfall (`c:red t:creature cmc<=3`). Paginado, 175 por página. |
| Autocomplete do campo de busca   | `GET /cards/autocomplete?q=...`             | Backend (proxy, com debounce no cliente) | Retorna até 20 nomes. Ideal para digitação.                                         |
| Resolver decklist importada      | `POST /cards/collection`                    | Backend                                  | **Endpoint principal da importação.** Até **75 identificadores por requisição**.    |
| Carta específica por printing    | `GET /cards/:id`                            | Backend                                  | Usado ao trocar arte/edição.                                                        |
| Todas as impressões de uma carta | `GET /cards/search?q=!"Nome"&unique=prints` | Backend                                  | Alimenta o seletor de arte (`F04`).                                                 |
| Tokens oficiais                  | `GET /cards/search?q=t:token ...`           | Backend                                  | Alimenta o gerador de fichas (`F10`).                                               |
| Banlist do Commander             | campo `legalities.commander` em cada carta  | Backend                                  | Valores: `legal`, `not_legal`, `restricted`, `banned`.                              |
| Bulk data (opcional, produção)   | `GET /bulk-data`                            | Job agendado                             | Baixa o dump `default_cards` para cache local. Ver §6.                              |

### 2.1 Contrato de `POST /cards/collection`

Requisição:

```json
{
  "identifiers": [
    { "name": "Sol Ring" },
    { "name": "Arcane Signet", "set": "eld" },
    { "id": "d5a0f3e2-1f7a-4b23-9b3a-7f0f5c1b2c3d" }
  ]
}
```

Resposta (resumida):

```json
{
  "object": "list",
  "not_found": [{ "name": "Sol Rng" }],
  "data": [
    {
      "id": "d5a0f3e2-...",
      "name": "Sol Ring",
      "mana_cost": "{1}",
      "cmc": 1,
      "type_line": "Artifact",
      "color_identity": [],
      "legalities": { "commander": "legal" },
      "image_uris": {
        "small": "https://cards.scryfall.io/small/...jpg",
        "normal": "https://cards.scryfall.io/normal/...jpg",
        "large": "https://cards.scryfall.io/large/...jpg",
        "png": "https://cards.scryfall.io/png/...png",
        "art_crop": "https://cards.scryfall.io/art_crop/...jpg"
      },
      "card_faces": []
    }
  ]
}
```

**Pontos de atenção obrigatórios:**

1. `not_found` **sempre** precisa ser tratado e devolvido ao usuário (fluxo de exceção do `CDU02`).
2. Cartas de dupla face (`layout` = `transform`, `modal_dfc`, `split`, `adventure`) **não têm**
   `image_uris` na raiz — as imagens ficam em `card_faces[n].image_uris`. Ignorar isso quebra o
   render de qualquer deck com MDFC.
3. `POST /cards/collection` aceita no máximo **75 identificadores**. Um deck de Commander (100 cartas,
   tipicamente ~70 nomes distintos) cabe em 1–2 requisições. Sempre agrupar por nome antes de enviar.

---

## 3. Rate limit e política de uso

A Scryfall pede explicitamente, em sua documentação pública:

| Regra                                    | Valor exigido                  | Como cumprimos                                                                     |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| Intervalo entre requisições              | **50–100 ms** (≈10 req/s máx.) | Fila serializada no backend com espaçamento de 100 ms; nunca disparar em paralelo. |
| `User-Agent` identificável               | Obrigatório                    | `AetherTable/1.0 (+https://aethertable.app; contato@...)`                          |
| `Accept`                                 | Recomendado                    | `application/json`                                                                 |
| Não fazer _scraping_ de imagens em massa | —                              | Imagens são carregadas pelo browser sob demanda, com cache.                        |
| Preferir bulk data para volume           | Recomendado                    | Job diário (§6).                                                                   |

**Implementação da fila (backend):**

```ts
// packages/scryfall-client/src/rateLimiter.ts
const MIN_INTERVAL_MS = 100;
let lastCall = 0;

export async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCall));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}
```

### 3.1 Tratamento de erros

| Status        | Significado               | Ação do backend                                                                                       |
| ------------- | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `200`         | OK                        | Segue o fluxo.                                                                                        |
| `404`         | Carta/rota não encontrada | Devolve a linha ao usuário como "não encontrada", **não** falha o import inteiro.                     |
| `422`         | Query malformada          | Devolve mensagem de validação (ex.: sintaxe de busca inválida).                                       |
| `429`         | Rate limit excedido       | _Backoff_ exponencial: 1 s, 2 s, 4 s, 8 s (máx. 4 tentativas). Depois disso, erro 503 para o cliente. |
| `500` / `503` | Falha na Scryfall         | Retry 2×; se persistir, servir do cache local e sinalizar "dados possivelmente desatualizados".       |

**Nunca** repassar `429` cru ao usuário final. O cliente recebe `503` com
`{ "error": "CARD_PROVIDER_UNAVAILABLE", "retryAfterSeconds": 30 }`.

---

## 4. Parser de decklist

O importador (`POST /api/decks/import`) precisa aceitar os formatos que a comunidade realmente usa.

### 4.1 Formatos suportados

```text
1x Sol Ring                       # Moxfield / TappedOut
1 Sol Ring                        # Archidekt
1 Sol Ring (C21) 263              # com set e número de coleção
4 Lightning Bolt [2XM]            # variação de bracket
1x Atraxa, Grand Unifier *F*      # marcador de foil (ignorar)
SIDEBOARD:                        # cabeçalho de seção
// Commander                      # comentário / seção
1 Kenrith, the Returned King #!Commander
```

### 4.2 Regra de parsing

```ts
// Uma linha por carta. Ordem de aplicação:
const LINE =
  /^\s*(?<qty>\d+)\s*[xX]?\s+(?<name>[^([#*]+?)\s*(?:\((?<set>[A-Za-z0-9]{2,5})\)\s*(?<cn>\S+)?)?\s*(?:\[(?<set2>[A-Za-z0-9]{2,5})\])?\s*(?:\*F\*)?\s*(?:#.*)?$/;
```

| Passo | Comportamento                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Linhas vazias e iniciadas por `//` ou `#` (sem `#!`) são descartadas.                                                                           |
| 2     | Cabeçalhos de seção (`SIDEBOARD`, `Commander`, `Deck`, `Maybeboard`) alternam o `board_type` corrente.                                          |
| 3     | Quantidade ausente ⇒ assume `1`.                                                                                                                |
| 4     | Nome é normalizado: `trim`, colapso de espaços, remoção de sufixo de foil.                                                                      |
| 5     | Nomes com `//` (dupla face) são enviados inteiros — a Scryfall resolve `Fire // Ice`.                                                           |
| 6     | `set` + número de coleção, quando presentes, viram `{ set, collector_number }` no identificador — garante a **arte exata** que o usuário pediu. |
| 7     | Nomes duplicados são agrupados somando quantidades **antes** de montar o batch.                                                                 |
| 8     | O comandante é detectado por: marcador `#!Commander`, seção `Commander`, ou seleção manual no Deckbuilder.                                      |

### 4.3 Limites de entrada (defesa)

| Limite                        | Valor                                                       | Motivo                                |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| Tamanho do payload de texto   | 64 KB                                                       | Evita abuso de memória.               |
| Linhas por importação         | 1.000                                                       | Um deck de Commander tem ~100.        |
| Quantidade por linha          | 1–99                                                        | Rejeita `999999x Sol Ring`.           |
| Caracteres permitidos no nome | letras Unicode, dígitos, `,` `'` `-` `/` `.` `!` `:` espaço | Sanitização anti-XSS (ver `DOC-051`). |

---

## 5. Estratégia de imagens

| Contexto                          | Qualidade da Scryfall                  | Peso aproximado      | Justificativa                                              |
| --------------------------------- | -------------------------------------- | -------------------- | ---------------------------------------------------------- |
| Verso de carta na Library         | asset local (`/public/card-back.webp`) | ~15 KB, 1 requisição | Nenhuma imagem da Scryfall é requisitada para zona oculta. |
| Carta no Battlefield / Hand       | `small` (146×204)                      | ~15–25 KB            | Suficiente para o Canvas em zoom padrão.                   |
| Hover / `alt+click` (zoom)        | `normal` (488×680)                     | ~80–120 KB           | Carregada **sob demanda**, uma por vez.                    |
| Painel de detalhe no Deckbuilder  | `normal`                               | ~100 KB              | Navegação lenta, tolera peso.                              |
| Arte de fundo / thumbnail de deck | `art_crop`                             | ~30 KB               | Recorte só da ilustração.                                  |

**Cache em três camadas:**

1. **CDN da Scryfall** (`cards.scryfall.io`) — já vem com `Cache-Control` longo; as imagens são imutáveis por `scryfall_id`.
2. **Service Worker** (`CacheStorage`) — intercepta `cards.scryfall.io`, estratégia _cache-first_,
   teto de **200 MB** com evicção LRU. Terras básicas, tokens comuns e o verso ficam pré-cacheados.
3. **Memória do Konva** — `Image` decodificada é reaproveitada entre sprites do mesmo `scryfallId`
   (um deck com 30 Mountains carrega **uma** textura).

> Regra dura: nunca pré-carregar as 100 imagens de um deck ao entrar na sala. Só o que está em
> `BATTLEFIELD` e `HAND` do próprio jogador é resolvido. Ver `DOC-040` §3.

---

## 6. Cache de metadados no nosso lado

Para não depender de latência externa a cada render e para sobreviver a quedas:

### 6.1 Tabela de cache (PostgreSQL)

```sql
CREATE TABLE card_cache (
  scryfall_id   UUID PRIMARY KEY,
  oracle_id     UUID NOT NULL,
  name          TEXT NOT NULL,
  set_code      TEXT NOT NULL,
  collector_num TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  cmc           NUMERIC(4,1),
  type_line     TEXT,
  mana_cost     TEXT,
  color_identity TEXT[],
  legal_commander TEXT,          -- legal | not_legal | banned | restricted
  layout        TEXT,            -- normal | transform | modal_dfc | split | ...
  image_small   TEXT,
  image_normal  TEXT,
  faces         JSONB,           -- imagens/nomes por face, quando aplicável
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_card_cache_name  ON card_cache (lower(name));
CREATE INDEX idx_card_cache_oracle ON card_cache (oracle_id);
```

### 6.2 Política de atualização

| Item                                    | Frequência                  | Mecanismo                                                                                |
| --------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| Metadados de carta (nome, imagem, tipo) | Imutáveis por `scryfall_id` | Grava uma vez; nunca revalida.                                                           |
| Legalidade / banlist                    | **Diária, 06:00 UTC**       | Job lê o bulk `default_cards` e atualiza `legal_commander`.                              |
| Bulk data completo                      | Diária                      | `GET /bulk-data` → baixa `default_cards` (~450 MB JSON) → ingere só os campos da tabela. |
| Cartas novas (spoilers)                 | Sob demanda                 | Miss no cache dispara `POST /cards/collection` e grava o resultado.                      |

O job de bulk é o que permite cumprir a recomendação da Scryfall de **não** usar a API para
volume, além de dar autonomia de busca (`GET /api/cards/search` pode responder do nosso banco).

---

## 7. Modos de falha e degradação

| Cenário                                | Impacto            | Comportamento esperado                                                                           |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| Scryfall fora do ar durante importação | Import falha       | Erro `503 CARD_PROVIDER_UNAVAILABLE`; o texto digitado é preservado no cliente para retentativa. |
| Scryfall fora do ar durante partida    | Nenhum             | Estado da sala usa UUIDs; imagens vêm do Service Worker.                                         |
| Imagem 404 (printing removida)         | Sprite quebrado    | Fallback: renderiza moldura cinza com o **nome** da carta em texto. Nunca deixar quadro vazio.   |
| `429` persistente                      | Importações lentas | Fila do backend enfileira; UI mostra "processando fila (posição N)".                             |
| Carta não encontrada no import         | Linha marcada      | Linha em vermelho no Deckbuilder, editável, resto do deck importa normalmente.                   |
| MDFC sem `image_uris` na raiz          | Carta invisível    | Parser **obrigatoriamente** cai para `card_faces[0].image_uris`. Coberto por teste unitário.     |

---

## 8. Conformidade

- **Atribuição.** O rodapé do Deckbuilder exibe: _"Dados de cartas fornecidos pela Scryfall."_
  com link para `https://scryfall.com`.
- **Sem revenda de dados.** Não expomos um endpoint público que replique a API da Scryfall para terceiros.
- **Imagens.** São servidas da CDN da própria Scryfall; não hospedamos cópias das artes.
- **Fan Content Policy da WotC.** Ver `RN04` em [regras_de_negocio_e_casos_de_uso.md](regras_de_negocio_e_casos_de_uso.md).

---

## 9. Checklist de implementação

- [ ] Pacote `packages/scryfall-client` com `User-Agent` fixo e fila de 100 ms.
- [ ] `throttled()` aplicado em **todas** as chamadas externas.
- [ ] Backoff exponencial para `429`/`5xx`.
- [ ] Parser de decklist cobrindo os 7 formatos da §4.1, com testes unitários por formato.
- [ ] Agrupamento por nome antes do batch de 75.
- [ ] Tratamento de `not_found` devolvido ao cliente linha a linha.
- [ ] Suporte a `card_faces` para MDFC/split/adventure.
- [ ] Tabela `card_cache` + migração Prisma.
- [ ] Job diário de bulk data com log de contagem de cartas atualizadas.
- [ ] Service Worker interceptando `cards.scryfall.io` com teto de 200 MB.
- [ ] Fallback visual de imagem quebrada (moldura + nome).
- [ ] Teste de integração com a Scryfall **mockada** simulando `429` e `404` (ver `DOC-052`).
