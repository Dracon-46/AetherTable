# AetherTable × EDHPlay — auditoria de paridade e plano de implementação

| Campo        | Valor                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| **ID**       | `DOC-094`                                                                              |
| **Origem**   | levantamento do EDHPlay v0.4.17 (08/09/2026) + auditoria de código arquivo por arquivo |
| **Natureza** | plano de execução com estado — atualize a tabela abaixo ao concluir uma fase           |

## Estado de execução

| Fase                                 | Situação         | Onde                                                |
| ------------------------------------ | ---------------- | --------------------------------------------------- |
| **A** — Furos e segurança            | ✅ **concluída** | `feature/fase-a-furos-e-seguranca`, 5 commits       |
| **B** — Barreira de entrada          | pendente         | —                                                   |
| **C** — Deckbuilder                  | pendente         | —                                                   |
| **D** — Salas (18, 19, 21)           | ✅ **concluída** | fatia 3a, 3b e modo espectador (v0.2.0)             |
| **D** — item 20 ("voltar à partida") | pendente         | —                                                   |
| **E** — Mesa                         | pendente         | —                                                   |
| **F** — Social e i18n                | pendente         | **decidido:** i18n completo, não remoção do seletor |

### O que a Fase A entregou, e o que ela corrigiu na própria auditoria

Cinco itens (I.4/I.8/II.4, I.2, I.1, I.3, I.5). Dois achados que **não estavam
neste documento** apareceram no caminho:

- `GET /users/me` devolvia o **`passwordHash`** — `findById` usava `include`,
  que traz todos os campos escalares do modelo.
- O `?token=` do OAuth **era lido**: `OAuthTokenCapture` existia e funcionava.
  A auditoria dizia que não. Ele foi adaptado para o fragmento, não duplicado.

E um item ficou **fora da Fase A por decisão**: o I.6 (idioma). A escolha foi
i18n de verdade em vez de remover o seletor — o que o coloca na Fase F, item
30, e não entre os furos.

---

Documento de execução, escrito para ser colado no Claude Code rodando na máquina
do Gaspare. Cobre o produto inteiro, não só configurações.

- **Lado EDHPlay:** levantamento de 08/09/2026, v0.4.17, sessão autenticada.
  Detalhamento em `claude/referencia-edhplay-configuracoes.md` (projeto AetherTable).
- **Lado AetherTable:** auditoria de código do branch `feat/preferencias-de-mesa`
  (commits `9463c9c` e `ad37ed0`), feita arquivo por arquivo.
- **Método:** para cada área, o que o EDHPlay tem, o que existe no AetherTable
  com caminho e símbolo real, o que falta, e como fazer melhor em vez de igual.

---

## Como usar este documento

1. **Leia a Parte 0 antes de tocar em qualquer arquivo.** São as regras do
   repositório, cada uma ligada a um defeito documentado no próprio código.
2. **A Parte I é o que eu faria primeiro**, e não tem nada a ver com o EDHPlay:
   são furos que já existem. Alguns são de segurança.
3. **A Parte II é a comparação área por área.** Cada área tem um veredito e um
   plano. Execute uma área por vez, com um commit por área.
4. **A Parte III é o que NÃO pode regredir** — onde o AetherTable já é melhor.
   Copiar o EDHPlay nessas áreas seria piorar.
5. **A Parte IV é a ordem de execução** com as dependências entre áreas.

O veredito de cada área usa esta escala:

| Símbolo | Significado                                                                         |
| ------- | ----------------------------------------------------------------------------------- |
| 🟢      | AetherTable está igual ou melhor                                                    |
| 🟡      | Existe, mas incompleto ou pior                                                      |
| 🔴      | Não existe                                                                          |
| ⚠️      | Existe e está **quebrado ou mentindo** — o schema/UI promete o que o código não faz |

---

## Parte 0 — As regras do repositório

Cada uma destas já causou um defeito registrado em comentário no código.

1. **`@colyseus/schema` serializa por ÍNDICE.** Campo novo em `RoomState`,
   `Player`, `Card` ou `Arrow` vai **no fim**. Inserir no meio desloca todos os
   seguintes e o cliente decodifica lixo — sem erro, sem aviso. Foi assim que
   `Player.mulliganCount` fez a mesa parar de receber cartas.

2. **`pnpm schema:sync` é obrigatório** após tocar qualquer schema.
   `apps/frontend/src/net/schema/*` é **gerado**. `mirror.spec.ts` roda o
   gerador em `--check` e falha se estiver defasado.

3. **Paridade de intenções é rastreada.** `tools/estado-implementacao.mjs`
   compara `IntentPayloadMap` (94 chaves), `REGISTRY` (87 handlers + `INTENT_SET_DECK`
   fora dele) e `net/intents.ts` (88 wrappers). Rode `pnpm docs:estado`.

4. **Ação de mesa restrita ao dono usa `exigirAnfitriao(ctx, 'INTENT_X')`**
   (`registry.ts`). Não escreva `seat === 0` à mão — foi o que deixou
   `INTENT_RESET_MATCH` e `INTENT_SET_TURN_ORDER` abertos a qualquer jogador.

5. **`window.location.href` em `dashboard/page.tsx:handleConnect` não vira
   `router.push`.** Há um comentário em caixa alta: a troca quebrou a entrada na
   mesa por causa de `TOKEN_ALREADY_USED` com `reactStrictMode`.

6. **`Card.scryfallId` tem `@view()`.** Toda mutação de zona ou de visibilidade
   termina em `reconciliarVisibilidade` / `reconciliarCartaParaTodos`. Esquecer
   isso vaza identidade de carta oculta — e o modelo é "falha fechada"
   (`schema/visibility.ts:podeVer`, 7 cláusulas).

7. **`zoneOrder` guarda `Card.id`, nunca `scryfallId`** (DOC-032 §3.1).

8. **Handler de intenção é síncrono e sem I/O** (DOC-021 §7). A exceção é
   `INTENT_SET_DECK`, tratado fora do `REGISTRY` em `AetherRoom.registrarIntencoesComIO`.

9. **Aleatoriedade só por `apps/game-server/src/services/rng.ts`** (RN06, CSPRNG).

10. **Commits sem atribuição a IA.** Sem `Co-Authored-By`, sem `Claude-Session`,
    sem "🤖 Generated with". Mensagem no estilo dos dois commits do branch: o que
    mudou e **por quê**, incluindo as alternativas descartadas.

11. **Estilo de comentário:** explique o defeito que a linha corrige ou a
    alternativa recusada, não o que o código faz. Português com acento.
    Cabeçalho de arquivo com bloco `─── TÍTULO ───`.

12. **Não existe motor de regras (RN01).** Turno, fase e pilha são rótulos. Toda
    proposta abaixo respeita isso: o sistema move peças e esconde informação.

---

## Parte I — Furos que já existem, antes de qualquer paridade

Nada aqui vem do EDHPlay. É o que a auditoria encontrou no estado atual. Os
quatro primeiros eu trataria antes de escrever uma linha de recurso novo.

### I.1 ⚠️ Cosméticos de apoiador são equipáveis por qualquer conta

- `apps/frontend/src/components/CosmeticPicker.tsx:Cadeado` é **decorativo**: os
  `<button>` de item `APOIADOR` não recebem `disabled` e chamam `equipar()` como
  qualquer item gratuito.
- `apps/backend-core/src/users/users.dto.ts:idDeCosmetico` valida só
  **existência no catálogo** (`ehSleeveValido` etc.), nunca o tier nem a posse.
  `UsersService.updateUser` grava direto.
- Não existe campo de tier no usuário (`User.supporterTier` não existe) nem
  integração de pagamento (zero ocorrências de Patreon, Stripe, checkout).
- Pior: há **duas trilhas de dados desconectadas**. `CosmeticItem`/`UserCosmetic`
  usam UUID; o jogo usa ids de texto (`aether-classic`). `UserPreference.activeSleeveId`
  e companhia são `@db.Uuid` com FK e **nunca são escritas** — o próprio schema
  documenta isso. `AdminUsuariosService.revogarCosmetico` limpa exatamente essas
  colunas mortas e **não** limpa `sleeveId`/`playmatId`/`borderId`/`titleId`/`petId`,
  que são as reais. **Revogar um cosmético não revoga nada.**

**Correção mínima:** `tierDoUsuario(userId)` no backend + recusa no
`AtualizarPerfilDto` quando o item é `APOIADOR` e o usuário não tem direito;
`disabled` real no `CosmeticPicker`; `revogarCosmetico` passa a limpar as colunas
de texto. **Enquanto não houver pagamento, decida e registre:** ou todo o
catálogo é gratuito (e o `Cadeado` sai), ou o tier vem de uma coluna
administrada pelo backoffice. Um cadeado que não tranca é pior que nenhum.

### I.2 ⚠️ O monitor do Colyseus está exposto sem autenticação

- `apps/game-server/src/index.ts:39` — `app.use('/colyseus', monitor())`, sem
  guard. O monitor lista salas, clientes e permite inspecionar estado.
- `GET /metrics` do game-server também está aberto (comentário no código diz
  "rede interna; bloquear na borda" — no Render, não está).
- E a tela `apps/frontend/src/app/admin/sistema/page.tsx` **afirma o contrário**:
  diz que "o monitor do Colyseus não está embutido aqui… ele não está montado no
  game-server". A UI de admin descreve uma realidade que não é a do servidor.

**Correção:** basic auth ou token no `/colyseus` e `/metrics` (Colyseus aceita
middleware antes do `monitor()`), ou montar só quando `!isProd`. E corrigir o
texto da tela de admin — uma tela de operação que mente sobre a superfície
exposta é pior que uma tela vazia.

### I.3 ⚠️ Token de sessão viaja na querystring, e o logout não desloga

- `apps/backend-core/src/auth/auth.controller.ts:redirecionarComToken` devolve
  `/dashboard?token=<jwt>`. A URL entra no histórico do navegador, no `Referer`
  e em qualquer log de proxy.
- `POST /auth/logout` é **corpo vazio, `return;`** — não revoga nada. E nenhum
  código do frontend chama essa rota: `dashboard/layout.tsx:handleLogout` só
  limpa o `localStorage`.
- TTL do access token: **24h** (`JWT_ACCESS_TTL='86400'` no `render.yaml`), sem
  refresh token e sem denylist. Sair da conta deixa um token válido por até um dia.

**Correção:** entregar o token OAuth por fragmento (`#token=`, não vai no
`Referer`) ou por cookie `httpOnly`; implementar denylist de `jti` no logout
(há Redis opcional no game-server, e a tabela de auditoria já existe); reduzir o
TTL e introduzir refresh. **`JWT_REFRESH_TTL` foi removido do `render.yaml` de
propósito** — registre a decisão nova no lugar dela.

### I.4 ⚠️ Banner de "DUMMY KEYS" renderizado em produção

`apps/frontend/src/app/page.tsx` renderiza **sempre** o banner _"Usando DUMMY
KEYS de OAuth (ambiente local)"_. A `/` é a porta de entrada do produto. Corrija
com `process.env.NODE_ENV !== 'production'` ou remova.

### I.5 ⚠️ "Partidas Jogadas" é sempre 0, em todo perfil

`prisma.matchSummary.create` **não existe em nenhum lugar do repositório** — só
`.count()`. `MatchSummary` e `MatchParticipant` nunca recebem uma linha. Logo:

- `dashboard/profile/page.tsx` e `u/[username]/page.tsx` mostram sempre 0;
- a métrica "Partidas" do backoffice é sempre 0;
- `MatchParticipant.userId` nullable existe para o expurgo de 30 dias de dados
  que nunca são gravados.

**Correção:** gravar o resumo no fim da partida. O gancho natural é
`AetherRoom.onDispose` (hoje só faz `salasAtivas.dec()`) chamando uma rota
interna nova (`POST /internal/matches/summary`, protegida por `InternalApiGuard`,
que já existe para `GET /internal/decks/:id`). Sem isso, nenhuma estatística de
jogador é possível.

### I.6 ⚠️ `language` persiste e não muda nada

- `user_preferences.language` existe, é validado, é devolvido no `GET /users/me`
  e **nenhum consumidor o lê**: `useHidratarPreferencias` aplica cosméticos e
  keybindings e ignora o idioma.
- `<html lang="pt-BR">` é fixo em `app/layout.tsx`. Zero ocorrências de
  `next-intl`, `i18next`, dicionários ou `[locale]` no repositório.
- O `select` de Ajustes oferece `pt-BR`, `en-US`, `es-ES`, e a mensagem de
  sucesso diz _"saia e entre novamente para ver o efeito global"_ — não há efeito.

**Decisão a tomar e registrar:** ou i18n de verdade (Parte II.16), ou o campo sai
da interface. Hoje é um controle que mente.

### I.7 Sem exportar deck, e importar destrói o deck

- **Não existe nenhuma rota ou botão de exportação** em nenhum formato. O deck
  entra e não sai. É lock-in e é problema de LGPD (portabilidade).
- `decks.service.ts:importDeckList` faz `deckCard.deleteMany` — **sempre
  substitui o deck inteiro**. Não há importação aditiva.
- A linha `SIDEBOARD` do texto colado é **ignorada** e tudo entra como `MAIN`.

### I.8 Furos menores, todos verificáveis

| Furo                                                                                                                                                   | Onde                                       | Efeito                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `roomCode` de 6 hex sem verificar colisão, sem registro no banco                                                                                       | `matches.service.ts:createMatch`           | duas mesas podem receber o mesmo código; a sala não existe até alguém conectar                                                      |
| Throttler global com estado **em memória**                                                                                                             | `app.module.ts:57`                         | não funciona com mais de um nó (documentado no próprio comentário)                                                                  |
| Sem job de expurgo LGPD dos 30 dias                                                                                                                    | nenhum cron/scheduler no repo              | `User.deletedAt` acumula para sempre                                                                                                |
| `Block` no schema com **zero uso**                                                                                                                     | `schema.prisma:320`                        | `PLAYER_BLOCKED` nunca é lançado; não há bloquear jogador                                                                           |
| `CardCache` (tabela) nunca lida nem escrita                                                                                                            | `schema.prisma:293`                        | o cache real é LRU em RAM; a tabela é peso morto                                                                                    |
| ~~`emailVerifiedAt` nunca escrito nem verificado~~ ✅                                                                                                  | `auth.service.ts`                          | **resolvido:** escrito no login por OAuth, e o vínculo por e-mail passou a exigir e-mail verificado pelo provedor                   |
| ~~"Esqueceu?" é `<a href="#">`~~ ✅                                                                                                                    | `app/senha/esqueci`                        | **resolvido:** recuperação de senha por e-mail, token de uso único de 30 min                                                        |
| Sem `<meta viewport>` / `export const viewport`                                                                                                        | `app/layout.tsx`                           | mobile depende do default do Next                                                                                                   |
| `UserPreference.theme`, `voiceMode`, `pttKey`, `masterVolume` sem UI e sem leitura                                                                     | `schema.prisma`                            | quatro colunas mortas                                                                                                               |
| `Deck.description`, `isPublic`, `isFavorite`, `colorIdentity`, `commanderId`, `partnerId`, `DeckCard.isCommander`, `DeckCard.sortOrder` nunca escritos | `schema.prisma`                            | oito colunas mortas                                                                                                                 |
| 8 wrappers de intenção sem chamador                                                                                                                    | `net/intents.ts`                           | `reorder`, `setCommander`, `setController`, `setCounter`, `setMaxHandSize`, `setPlayerCounter`, `setTurnOrder`, `setZoneVisibility` |
| `apps/frontend/src/canvas/layout.ts:montarMesa` e `montarGrade` sem chamador                                                                           | `layout.ts`                                | dois layouts completos e inacessíveis                                                                                               |
| `BOARD_TYPES` divergente entre `shared-types` (12) e o DTO do backend (8)                                                                              | `cards-catalog.ts` × `decks/board-type.ts` | quatro board types inatingíveis                                                                                                     |

---

## Parte II — Área por área

### II.1 Entrada no produto — landing, autenticação, onboarding · 🔴

**EDHPlay:** landing pública com proposta de valor, **"Jogar demo"** sem conta,
vitrine de decks públicos jogáveis com um clique ("Jogar este deck"), contador
de jogadores online ao vivo (~4.400), banner de cookies, changelog versionado
com badge de não-lido, e **FAQ de 22 perguntas** organizada em 6 seções. O FAQ
diz explicitamente: _"Nada para instalar, e sem conta até jogar com outras
pessoas."_

**AetherTable:** a rota `/` **é a tela de login** (`app/page.tsx:LoginPage`).
Não há landing, não há demo, não há como ver o produto antes de criar conta. O
`metadata` do `layout.tsx` tem só `title` e `description`; zero Open Graph, zero
`robots`, zero `sitemap`, zero favicon. Cadastro em `/register` sem confirmação
de senha, sem medidor de força, sem aceite de termos. Nenhuma tela de ajuda,
FAQ, tutorial, termos, privacidade ou contato existe (`grep` por `help`, `faq`,
`ajuda`, `tutorial`, `onboarding`, `tour` retorna zero rotas).

**Plano — e onde fazer melhor:**

1. **Landing em `/`, login em `/login`.** Mover a tela atual e criar a landing.
   A `CenaDoDragao` já é um ativo visual forte e está desperdiçada atrás de um
   formulário de login.
2. **Modo demo sem conta.** O AetherTable tem uma vantagem enorme e escondida
   aqui: o formato `solo` (`format.ts:id:'solo'`, `jogadores.min = 1`) e a mesa
   já funcionam com um assento. Um `/demo` que abre uma mesa de um jogador com
   um deck inicial, sem `seatToken` de conta, é a conversão que falta. O EDHPlay
   chama isso de "Jogar demo" e é o primeiro botão da página dele.
3. **Contador de jogadores online.** O game-server já expõe
   `ws_connections_active` em `/metrics` (`apps/game-server/src/metrics.ts`). Uma
   rota pública `GET /online` derivada do gauge (não do `/metrics` inteiro, que
   deve ser fechado — ver I.2) resolve, sem banco.
4. **Página de ajuda gerada do código.** Aqui está a chance de ficar melhor: o
   EDHPlay tem 22 respostas escritas à mão, que envelhecem. O AetherTable tem
   `packages/shared-types/src/format.ts` com **30 presets** completos (tamanho de
   deck, singleton, teto de raridade, reserva, regras de comandante) e
   `ACOES_DE_ATALHO`. Uma `/ajuda` que **renderiza as regras a partir dos presets**
   e a tabela de atalhos a partir do catálogo nunca fica desatualizada. O FAQ do
   EDHPlay diz "Commander precisa de exatamente 100 cartas" num texto fixo; o
   nosso pode dizer isso a partir da mesma constante que valida o deck.
5. **Termos, privacidade e disclaimer de Fan Content.** O EDHPlay tem rodapé
   completo com a declaração da Wizards Fan Content Policy, canal para
   detentores de direitos, termos e privacidade. **Isto não é opcional se você
   publicar.** Copie a estrutura: não oficial, sem venda de cartas, sem torneios,
   sem serviços ranqueados, uso não comercial, e um endereço de contato.
6. ~~Corrigir I.4 (banner de dummy keys), I.3 (token na URL) e o "Esqueceu?".~~ ✅ **feito.** O banner
   saiu e foi substituído por `GET /auth/provedores` — o botão do provedor só é desenhado quando ele
   existe no servidor, em qualquer ambiente. O "Esqueceu?" leva a `/senha/esqueci`. Na mesma passagem
   apareceram três coisas que **não estavam nesta auditoria**: as credenciais de OAuth nunca
   estiveram no `render.yaml` (em produção os botões levavam a uma página de erro do Google); o
   `state` do OAuth **não era verificado** (`NullStore` do `passport-oauth2`), embora DOC-050 §2.4 o
   desse como existente; e o vínculo por e-mail aceitava e-mail **não verificado** pelo provedor, o
   que é um caminho de tomada de conta pelo Discord.
7. `export const viewport` + `manifest` + ícones — ver II.22.

### II.2 Taverna / dashboard / browser de salas · 🔴

**EDHPlay:** lista de salas com busca por nome, três filtros (formato /
comunicação / idioma), paginação, contador de online, e um card por sala com
nome, "Formato · Nível de poder", selo `JOGO INICIADO`, ocupação `x/y`, selo de
comunicação e a ação certa por estado — **Entrar**, **Assistir** ou **Na Sala**.
Detalhe de design que vale copiar: **sala cheia não desaparece da lista, vira
conteúdo assistível.** É o que mantém a lista viva com poucas salas abertas.

**AetherTable:** dois cartões — "Criar Mesa Privada" e "Entrar com Código" — e a
lista de decks. **Não existe browser de salas.** `setMetadata` tem **zero
ocorrências no repositório**; `getAvailableRooms` não é usado; não há nome de
sala (`roomName` não existe em nenhum schema), não há visibilidade pública vs
privada (toda sala é privada por código), não há contador de online, não há
"voltar à partida", não há histórico. O placeholder do campo de código diz
`EX: DRG-402` e o formato real é 6 hex maiúsculos — o exemplo está errado.

**Plano:** é a **Fatia 3a** já especificada em `claude/fatia-3-configuracao-de-sala.md`.
Resumo: `ConfigDeSala` em `shared-types` (nome, formato, visibilidade,
comunicação, idioma, máx. jogadores, nível de poder declarado),
`normalizarConfigDeSala` usada pelo cliente **e** pelo servidor,
`CriarPartidaDto` no backend, campos novos no fim do `RoomState`,
`this.setMetadata(...)` no `AetherRoom`, `GET /salas` no express que já serve
`/health`, e `GAME_HTTP_URL` derivado de `WS_URL` no frontend.

**Onde fazer melhor:** o EDHPlay expõe o nível de poder da sala como filtro
social. O AetherTable tem 30 presets de formato com regras reais — a lista pode
filtrar por **formato de verdade** (Duel Commander, Oathbreaker, PDH, Tiny
Leaders, Pauper EDH…) e o card pode dizer "100 cartas, singleton, comandante
obrigatório" a partir do preset, em vez de uma etiqueta que ninguém valida.

Dois consertos que entram junto:

- Corrigir o placeholder do código para o formato real.
- **"Voltar à partida":** hoje quem recarrega a aba fora da mesa perde o
  caminho de volta. O `seatToken` é de uso único, então o retorno precisa de uma
  rota que reemita o passe para quem já tem assento na sala. Sem isso a janela de
  reconexão de 90 s (`RECONNECTION_WINDOW_S`) só serve para quem não fechou a aba.

### II.3 Decks — lista · 🟡

| Item              | EDHPlay                                           | AetherTable                                                                                     |
| ----------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cota visível      | `(4/20)`                                          | 🔴 não existe limite nem contador                                                               |
| Pastas            | ✅ "Nova Pasta", com contador                     | 🔴 nenhum model, rota ou UI                                                                     |
| Busca             | por nome do deck **e** por comandante             | 🟡 um campo local que filtra `name` ou `formatId`, só aparece com >5 decks, não vai ao servidor |
| Filtro de formato | ✅                                                | 🟡 existe só embutido na busca de texto                                                         |
| Ordenação         | ✅                                                | 🔴 fixo em `updatedAt desc`, sem controle                                                       |
| Card do deck      | nome, "Commander · B5", pips de identidade de cor | 🟡 nome, contagem, nome do formato, data — **sem identidade de cor, sem arte do comandante**    |
| Ações             | —                                                 | 🟡 Visualizar / Editar / Destruir. 🔴 duplicar, renomear na lista, favoritar, mover para pasta  |

**Plano:**

1. **Identidade de cor no card.** `Deck.colorIdentity` **já existe no schema e
   nunca é escrito**. Calcular no `addCard`/`removeCard`/`import` (a
   hidratação já traz `colorIdentity` por carta) e renderizar os pips. É o
   sinal que faz uma lista de 20 decks ser legível de relance.
2. **Arte do comandante no card.** `Deck.commanderId` também já existe e nunca é
   escrito. Preenchê-lo no toggle de comandante dá miniatura no card, e resolve
   de graça o "buscar por comandante" que o EDHPlay tem.
3. **Favoritar.** `Deck.isFavorite` existe e não é usado. Uma linha de DTO.
4. **Duplicar deck.** `POST /decks/:id/duplicate`. É a ação que falta para
   testar uma variação sem destruir a lista original — e o EDHPlay também não
   tem, então é onde ficar melhor.
5. **Pastas.** Model novo (`DeckFolder`) + `Deck.folderId`. Precisa de migração.
6. **Cota.** Decida um número e mostre-o. O EDHPlay usa 20. Uma cota invisível
   que estoura em produção é pior que uma cota escrita na tela.

### II.4 Decks — editor · 🟡 com um 🔴 grande nas estatísticas

**EDHPlay:** cabeçalho com formato, contagem, bracket e status de validação;
preço total e **por categoria**, com botão de compra; seções Zona de Comando
(Comandante + Parceiro), Criatura, Feitiço, Mágica Instantânea, Artefato,
Encantamento, Terreno, **Sideboard 0/15**, **Fichas 0/15**; visualização
Grade/Texto; ordenar por Valor de Mana/Nome; agrupar por Nenhum/Tipo/Raridade/
Mana/Cor; idioma da carta por deck; seletor de formato; seletor de bracket;
Testar / Exportar / Importar. E um painel **ESTATÍSTICAS DO DECK** com:

```
100 cartas · 1.83 valor de mana médio · 28 Terreno · 72 Feitiços · 22 Game changers
CURVA DE MANA        histograma 0,1,2,3,4,5,6,7+
TIPOS DE CARTA       Criatura 13 · Feitiço 10 · Instantânea 33 · Artefato 11 · Encantamento 5 · Terreno 28
REQUISITOS DE COR    W 12 · U 32 · B 23 · R 8
MAIS CARAS           top 5 com preço
PALAVRAS-CHAVE       Flash 2 · Partner 2 · Storm 2 · Treasure 2 · Amass 1 …
```

**AetherTable** (`app/dashboard/decks/[id]/page.tsx`, `deckbuilder/*`):

- 🟢 **Três** visualizações (lista, compacta, galeria) contra duas, com tamanho
  de arte P/M/G e preferências persistidas.
- 🟢 Agrupamento por tipo / cor / cmc / nenhum, com ordem de grupos definida
  (`agrupar.ts:ORDEM_DOS_GRUPOS`) e grupos de cor nomeados em ordem WUBRG.
- 🟢 Modo ver ⇄ editar explícito (`?modo=ver`), com todas as ações desligadas em
  leitura.
- 🟢 Escrita otimista em tudo (`useDecks.ts`), com carta pendente marcada e
  botões travados até reconciliar.
- 🟢 **Painel de legalidade muito superior** — ver II.6.
- 🟡 Ordenação **dentro** do grupo é fixa (comandante, depois nome). Não há
  seletor de ordenação.
- 🟡 Preço só total, em USD, no cabeçalho. Sem preço por carta, sem por
  categoria, sem EUR/tix, sem foil.
- 🟡 Cabeçalho mostra `Formato: {deck.formatId}` — **o id cru em maiúsculas**,
  não o nome do preset. Um bug de exibição de uma linha.
- 🔴 **Nenhuma estatística visual.** Não há curva de mana, distribuição de
  cores, contagem de tipos como painel, média de cmc, requisitos de cor,
  palavras-chave, nem top de preço. **Não há nenhuma biblioteca de gráfico no
  frontend.** É o maior buraco isolado do deckbuilder.
- 🔴 Sem UI de **sideboard**, maybeboard, fichas/tokens, cube, planar, scheme,
  signature spell — os board types existem no enum e nenhuma tela os cria.
- 🔴 Sem seção de **parceiro** (`Deck.partnerId` morto). Dois comandantes só
  marcando dois `COMMANDER`.
- 🔴 Sem seletor de formato no editor (`AtualizarDeckDto` só aceita `name`).
- 🔴 Sem preview de carta com oracle text no deckbuilder. Clicar numa carta abre
  o seletor de impressão, não uma prévia.
- 🔴 Sem campo para digitar quantidade (só `+`/`−`), sem drag-and-drop, sem
  multi-seleção, sem undo.

**Plano, em ordem de valor:**

1. **Painel de estatísticas.** Tudo que o EDHPlay mostra é derivável do que a
   hidratação já traz por carta (`cmc`, `typeLine`, `manaCost`, `colorIdentity`,
   `rarity`, `priceUsd`). Escreva um `deckbuilder/estatisticas.ts` puro, com
   teste unitário, e desenhe em SVG inline — **não instale biblioteca de
   gráfico** para quatro barras e um histograma. `apps/frontend/src/app/globals.css`
   já tem o vocabulário de cor do produto.
   - Onde ficar melhor: **fontes de mana por cor** contra **requisitos de cor**
     no mesmo gráfico. O EDHPlay mostra só os requisitos (quantos pips U o deck
     pede); quem monta manabase quer as duas curvas sobrepostas. É a informação
     que o jogador de Commander mais procura e nenhum dos dois tem.
2. **Sideboard e fichas.** A zona `SIDEBOARD` já existe ponta a ponta na mesa
   (`INTENT_FETCH_FROM_SIDEBOARD`, `ZoneInspector`, `formato.deck.reserva`) e é
   inalcançável no editor. É uma aba nova na lista, um `boardType` no
   `addCard` e o respeito à linha `SIDEBOARD` no import.
3. **Preview com oracle text no hover.** O `CardMeta` do catálogo do cliente
   (`cards/catalog.ts`) já tem `oracleText`, `manaCost`, `power`, `toughness`,
   e a mesa já tem `CardHoverPreview.tsx` funcionando. Reaproveitar o componente
   no deckbuilder é barato e é o que torna a lista utilizável para quem não
   decorou 100 cartas.
4. **Parceiro / segundo comandante** com seção própria, escrevendo `Deck.partnerId`.
5. Consertos de uma linha: nome do formato em vez do id; campo de quantidade
   digitável; seletor de ordenação dentro do grupo.

### II.5 Decks — busca de cartas e impressões · 🟡

**EDHPlay:** campo "Adicionar uma carta…" com autocomplete visual (grade de
artes) dentro do editor, além da importação em massa.

**AetherTable** (`deckbuilder/CardSearch.tsx`):

- 🟡 **Um único campo de texto livre**, repassado cru como `q` para
  `GET /cards/search?q=…&unique=prints`. A sintaxe da Scryfall (`t:goblin`,
  `c:u`, `cmc>3`) funciona **por acidente** — o placeholder até sugere `t:goblin`.
  Não existe nenhum filtro estruturado: tipo, cor, cmc, raridade, set, oracle,
  P/T, legalidade, preço.
- 🔴 **Sem paginação.** `MAX_RESULTADOS = 20` com `.slice(0,20)`; o `has_more`
  da Scryfall é ignorado e o parâmetro `page` da rota do backend **nunca é usado
  pela UI**.
- ⚠️ `GET /cards/autocomplete` **existe no backend e nenhum arquivo do frontend
  o chama.** Uma rota pronta, testada e órfã.
- 🟡 O resultado mostra miniatura, nome, tipo e set. Não mostra preço, raridade,
  custo de mana, legalidade, nem **se a carta já está no deck** — o que faz o
  jogador adicionar duplicata em formato singleton e só descobrir no painel de
  legalidade.
- 🟢 `PrintingPicker.tsx` resolve todas as impressões em **uma** requisição
  (`GET /cards/printings/:id` resolve o `oracle_id` no servidor) e o modelo de
  dados é impressão absoluta (`DeckCard.scryfallId`), que é o desenho certo.
- 🟡 O `PrintingPicker` tem `lang` na interface e **não o exibe nem filtra**.

**Plano:**

1. **Ligar o autocomplete que já existe.** Uma chamada, e a busca deixa de
   depender de o jogador saber a sintaxe da Scryfall.
2. **Filtros estruturados que compõem a query.** Aqui está a chance de ficar
   claramente melhor: chips de cor (WUBRG+C), faixa de cmc, tipo, raridade, e um
   toggle **"só o que é legal neste deck"** — o AetherTable tem o motor de
   legalidade (`avaliarLegalidade`) e a identidade de cor do comandante já
   calculada, então "esconda o que eu não posso jogar" é uma linha de filtro que
   o EDHPlay não tem como oferecer.
3. **Marcar "já no deck"** no resultado, com a quantidade.
4. **Paginação** usando o `page` que a rota já aceita.
5. Exibir e filtrar `lang` no `PrintingPicker` — pré-requisito de II.16.

### II.6 Decks — legalidade e bracket · 🟢 na legalidade, 🟡 no bracket

**Legalidade — o AetherTable está muito à frente.** `packages/shared-types/src/legalidade.ts:avaliarLegalidade`
produz **17 códigos de achado** com gravidade (`CONTADOR_DESSINCRONIZADO`,
`TAMANHO`, `SINGLETON`, `COPIAS`, `BANIDA`, `RESTRITA`, `FORA_DO_FORMATO`,
`RARIDADE`, `VALOR_DE_MANA`, `RESERVA`, `LISTA_DE_PONTOS`, `SEM_COMANDANTE`,
`COMANDANTES_DEMAIS`, `TIPO_DE_COMANDANTE`, `RARIDADE_DO_COMANDANTE`,
`IDENTIDADE_DE_COR`, `SEM_FEITICO_ASSINATURA`), distingue **erro que bloqueia a
mesa** de **aviso**, roda no cliente e no servidor a partir da mesma função, tem
~45 testes, e marca a carta banida na própria linha (`line-through` + badge). O
EDHPlay mostra "Válido" ou não. **Não regrida isso.**

**Bracket — aqui o EDHPlay ganha, e por uma diferença de método.**

- `deckbuilder/agrupar.ts:calcularBracket` é uma heurística com **duas listas de
  nomes hardcoded**: `CARTAS_CEDH` (16 nomes, 3 pontos) e `CARTAS_FORTES` (9
  nomes, 1 ponto), com faixas de soma. 25 nomes decidem o bracket de qualquer
  deck de Magic.
- O EDHPlay usa o **Commander Bracket oficial** e o painel de estatísticas dele
  exibe **"22 Game changers"** — ou seja, ele carrega a lista oficial de Game
  Changers da Wizards e conta. Ele também mostra turno estimado de vitória,
  explicação no hover, e o bracket vizinho quando o deck está no limite.

**Plano:** trocar as 25 constantes pela **lista oficial de Game Changers**
(mantida como dado, não como código, para atualizar sem deploy — a Scryfall tem
`game_changer` como campo, então a hidratação já pode trazê-lo) e implementar os
critérios oficiais dos brackets 1–5. Enquanto isso não existir, **a interface
deve chamar o valor de "estimativa", não de "bracket"**, e a fatia 3 já registra
que o nível de poder da sala é _declarado_. Um número que se parece com o
bracket oficial e não é gera discussão na mesa.

### II.7 Decks — importar / exportar · 🔴 no exportar

Ver I.7. O parser de importação em si é bom (`LINE_REGEX` aceita `1 Sol Ring`,
`1x`, `(SET) collector`, `[SET]`, `*F*`, `# comentário`, e tem dois fallbacks) —
melhor que a sintaxe documentada do EDHPlay. O que falta:

1. **Exportar** em texto simples, com opção "incluir impressões" (o EDHPlay tem
   exatamente essa caixa) — e, indo além dele, MTGA/MTGO e JSON.
2. **Importar aditivo** além de substituir, com o aviso de qual dos dois vai
   acontecer **antes** do clique.
3. **Respeitar `SIDEBOARD`** no texto colado (depende de II.4.2).
4. Relatório de importação: `notFound` já existe; adicione as linhas que o
   parser não entendeu, separadas das cartas que a Scryfall não achou. São
   problemas diferentes e hoje caem no mesmo balde.

### II.8 Decks — social: público, explorar, comentários · 🔴

**EDHPlay:** página **Explorar** com abas Todos/Curtidos, ordenação, filtros de
formato, cores e bracket, busca por nome de deck / comandante / usuário,
contador de curtidas, e **comentários** com respostas, edição/exclusão do
próprio, `[[Nome da Carta]]` virando link com prévia no hover, e denúncia.
Decks públicos aparecem na home com "Jogar este deck".

**AetherTable:** ⚠️ `Deck.isPublic` **existe no schema, com índice
`@@index([isPublic])`, e tem zero uso em código.** Não há rota de listagem
pública, não há página de deck de terceiro, não há comentários, curtidas,
visualizações, nem cópia de deck alheio.

**Plano:** é a área com maior relação valor/esforço depois das estatísticas,
porque o schema já previu o essencial.

1. `PATCH /decks/:id` aceita `isPublic`; toggle no editor com texto que explica
   o que muda.
2. `GET /decks/publicos` com filtros (formato, cores via `colorIdentity` — que
   II.3.1 passa a preencher, bracket) e paginação por cursor (o padrão já usado
   no admin).
3. Página `/decks/[id]` acessível sem ser dono quando `isPublic`, em modo
   leitura — **o modo já existe** (`?modo=ver` desliga todas as ações).
4. **"Jogar este deck"**: criar mesa solo com o deck público. Depende de II.1.2.
5. Comentários: model novo + `[[Carta]]` reaproveitando o `CardHoverPreview`.
6. **Onde ficar melhor:** o AetherTable tem denúncia com snapshot congelado
   (`DenunciarJogador.tsx` + `Report.snapshot`) e um backoffice de triagem com
   auditoria. Comentário público nasce, no nosso caso, já com moderação de
   verdade — o EDHPlay acabou de adicionar "reporting" na v0.4.17.

### II.9 Seleção de deck e decks iniciais · 🔴 nos decks iniciais

**EDHPlay:** o diálogo de escolha tem duas abas — **Meus Decks** e **Decks
Iniciais**, com **26 listas prontas** (nome temático + comandante). O FAQ é
explícito: _"Sim. Escolha um dos Decks Iniciais ao entrar em uma sala e já pode
jogar."_ Há também um botão **Deck Aleatório**.

**AetherTable:** `RoomLobby.tsx` tem um `<select>` com os decks do usuário. Sem
decks iniciais, sem deck aleatório. Quem cria conta e entra numa sala **não tem
o que jogar** até montar 100 cartas à mão.

**Plano:** é a barreira de entrada mais alta do produto hoje.

1. **Decks iniciais como dado versionado**, não como registro de banco: um JSON
   por deck em `packages/shared-types` ou `apps/backend-core/prisma/seed.ts`, com
   as listas em texto passando pelo **mesmo parser de importação** que já existe.
   Cinco a dez decks cobrem o caso; 26 é excesso para começar.
2. `GET /decks/iniciais` e a segunda aba no seletor do lobby.
3. **Deck aleatório**: sorteia entre os meus e os iniciais.
4. Onde ficar melhor: o AetherTable tem 30 presets de formato. Os decks iniciais
   podem ser marcados por formato e o seletor só oferece os compatíveis com a
   sala — o EDHPlay lista os 26 sempre.

### II.10 Lobby da sala · 🟡

**EDHPlay:** painel "Configurações de Jogo" visível a todos, editável pelo dono:
Tipo de Mulligan (Commander / London / Livre), Jogador Inicial (Aleatório /
Você), "Usar a ordem dos lugares do lobby", Permitir Sideboard, Cronômetro de
turno. Mais: assentos com estado, "Compartilhar Sala" (copia link), "Fale com
seus Oponentes" (cria canal Discord), contagem regressiva de início.

**AetherTable** (`overlay/RoomLobby.tsx`): código + copiar, chips de formato e
lugares, seletor de grimório, lista de assentos com pronto/anfitrião/conectado,
remover jogador, "Estou pronto", "Iniciar partida", "Sair da sala".
🔴 Nenhuma das cinco configurações de jogo. ⚠️ `INTENT_SET_TURN_ORDER` tem
handler e wrapper e **nenhuma tela o chama** — a ordem de assentos existe no
servidor e não tem interface.

⚠️ **E um desequilíbrio silencioso:** `INTENT_START_MATCH` faz
`ctx.state.activePlayerId = eu.id` — **quem clica em iniciar começa a partida**.
Como só o anfitrião pode iniciar, o anfitrião começa **todas** as partidas.

**Plano:** é a **Fatia 3b** de `claude/fatia-3-configuracao-de-sala.md`, com uma
intenção só (`INTENT_SET_ROOM_CONFIG`, `exigirAnfitriao`, recusada fora de
`WAITING`), campos novos no fim do `RoomState`, `pnpm schema:sync`, e o sorteio
de quem começa via `services/rng.ts`. A ordem de assentos é dar UI ao
`INTENT_SET_TURN_ORDER` que já existe, não criar intenção nova.

**Onde ficar melhor:** o cronômetro do EDHPlay é um interruptor. Faça o nosso
**contar e avisar, nunca agir** (RN01 — um cronômetro que passa o turno seria a
primeira regra que o servidor impõe), e calcule no cliente a partir de um
`turnoIniciadoEm` no estado, em vez de um broadcast por segundo.

### II.11 Mesa — tabuleiro e layout · 🟢 com dois furos

**EDHPlay:** dois layouts alternáveis (Grade / Barra lateral), tamanho de carta
0.5–3.0, alinhar à grade, foco automático no jogador ativo, playmats e sleeves,
preview no hover, mesa fixa sem zoom.

**AetherTable** (`canvas/GameBoard.tsx`, `canvas/layout.ts`): mesa focada em
pixels reais, trilho de oponentes flutuante, escala derivada da altura com fator
do jogador 0.5–2.0 (fatia 1), alinhar à grade de meia carta, câmera segue o
turno, playmat/sleeve/pet procedurais, vínculo de anexo desenhado, setas de
alvo, pings, interpolação de movimento com `prefers-reduced-motion`.

🟢 Melhor que o EDHPlay em três pontos concretos: o **vínculo de anexo desenhado**
como linha até o pai, as **setas de alvo persistentes com âncora em jogador**, e
os **pings posicionais**. Nada disso existe no EDHPlay.

Dois furos:

- ⚠️ **`montarMesa` e `montarGrade` são dois layouts completos e inacessíveis.**
  Existem em `layout.ts`, com testes, e nenhuma tela os chama — só
  `montarMesaFocada` é usada. O atalho "Alternar Layout (Grade / Barra lateral)"
  do catálogo de atalhos está `Not set` porque **não há para onde alternar**. Ou
  ligue o seletor (o `ExibicaoControls` é o lugar), ou remova os dois e o atalho.
  Um layout morto com teste passando é o pior dos dois mundos.
- 🟡 `CardHoverPreview.tsx` é `hidden lg:flex` — **não existe prévia em tela
  menor que `lg`**, e é justamente onde a carta é menor.

Marcadores visuais que faltam no `CardSprite`: `enteredThisTurn`, `isCopy`,
`exiledBy` (quem exilou), `phasedOut` (só opacidade). Os quatro campos existem
no `Card` e não têm representação.

### II.12 Mesa — painéis e HUD · 🟢 claramente melhor

**EDHPlay:** painel de vida com +/-, rastreador de mana WUBRGC, dois contadores
auxiliares, fases, dados, reações, menu do jogo com 6 itens.

**AetherTable:** o `LifePanel` tem três modos de exibição, vida com edição
direta, **dano de comandante rotulado com o nome da carta comandante** (parceiros
juntos), monarca, iniciativa, **cinco contadores de jogador** (veneno, energia,
experiência, radiação, ingresso), velocidade 0–4 (Aetherdrift), o Anel 0–4, taxa
de comandante, Dia/Noite, eliminação com motivo, indicador de fala e de conexão,
avatar com borda de perfil e título de chat. O `CardEditor` faz marcadores
nomeados, P/T com override, dano, anotação e destaque em cinco cores. O
`SelectionBar` faz ações em lote. O `ZoneInspector` mostra "vendo junto" com
revogação por observador.

🟢 **Isto é bem mais completo que o EDHPlay.** Não regrida.

Faltas reais:

- 🔴 **Rastreador de mana (pool WUBRGC).** O EDHPlay tem e o AetherTable não —
  nem no `Player`, nem em intenção. É o único item do HUD dele que falta aqui.
  Cabe como `MapSchema<number>` em `Player` (campo no fim) + `INTENT_SET_MANA`,
  ou como contador de jogador reaproveitando `ADD_PLAYER_COUNTER` com chaves
  `MANA_W`… — a segunda opção não exige schema novo.
- ⚠️ Ajuste de vida/contador é condicionado a `isMe` em todo o `LifePanel`. Numa
  mesa presencial-remota é comum alguém corrigir a vida de quem se distraiu. O
  EDHPlay também não permite; mas o `INTENT_SET_LIFE` já aceita alvo, então é
  uma decisão de UI, não de contrato.
- ⚠️ `INTENT_SET_MAX_HAND_SIZE` sem UI; `ringBearerId` sem UI (o Anel existe,
  escolher o portador não).

### II.13 Mesa — menus de contexto · 🟡

**EDHPlay:** seis menus com submenus. Grimório com 10 itens e 3 submenus
(`Ver →` com 5 opções, `Mover X do Topo →` com 3, `Mover Tudo Para →` com 2);
zona (Mão/Cemitério/Exílio) com 3; carta na mão com 6; carta no campo com 9 e 3
submenus (`Contadores →` com 6, `Poder/Resistência →` com 6, `Mover Para →` com
6); campo vazio com 6.

**AetherTable** (`overlay/ContextMenu.tsx`): lista **plana**, sem nenhum submenu.

- `library`: 13 itens — e aqui é **melhor**: Scry 1, Scry 2, **Surveil 1**,
  Comprar até 7, Moer 1, Exilar 1 do topo, Buscar (tutor). Surveil e scry são
  transacionais (`ScryModal` reordena e confirma). O EDHPlay não tem surveil nem
  transação de scry.
- `zone`: 11 itens, incluindo Revelar minha mão, Descartar a mão, Limpar tokens.
- carta: `Inspecionar` sempre; o resto só para quem controla. Campo: virar,
  virar para baixo, +1/+1, −1/−1, limpar marcadores, trazer para frente,
  transformar, anexar/desanexar, editor completo, copiar para a mesa, apontar
  seta, **"Enviar para a mesa de <nome>" com uma entrada por oponente**, revelar,
  ocultar, mover para mão/cemitério/exílio/topo, destruir token, anotar.

Faltas:

- 🔴 **Nenhum submenu.** Com 20+ itens numa lista plana de `w-56` e
  `max-h-[60dvh]`, o menu de uma permanente já rola. Submenu para `Mover para →`,
  `Contadores →` e `Enviar para →` é o conserto — o último especialmente, porque
  hoje cada oponente é uma linha no nível raiz.
- 🔴 **Carta em cemitério, exílio, reserva e grimório não tem menu de contexto.**
  A única superfície delas é o `ZoneInspector`. No EDHPlay o botão direito
  funciona em qualquer carta visível.
- 🔴 **Não existe menu de contexto de jogador.** No EDHPlay é onde estão
  expulsar e denunciar. Aqui as duas ações existem, escondidas no `PlayersModal`.
  Botão direito no rótulo da faixa ou no cartão de vida é o caminho natural.
- 🔴 Menu de campo vazio distinto do menu de zona (hoje é o mesmo).

### II.14 Mesa — atalhos · 🟡 no catálogo, 🟢 no mecanismo

**EDHPlay:** ~60 bindings em 6 grupos, todos remapeáveis, vários deliberadamente
`Not set`.

**AetherTable:** o mecanismo de remapeamento foi construído no commit `ad37ed0`
e é **melhor** que o do EDHPlay: gramática canônica de tecla com caixa
preservada, `ctrl`/`meta` colapsados para funcionar em macOS e Windows,
`ALIAS_DE_TECLA` para ABNT2 (`+`→`=`, `_`→`-`), conflito resolvido nomeando quem
perdeu a tecla, validação no servidor contra o catálogo, e 26 testes só da
gramática.

⚠️ **E o catálogo tem 13 ações contra ~60.** `net/intents.ts` tem **88
emissores funcionando** e apenas ~10 têm tecla. Construí o motor e não o
populei.

**Plano — expandir `ACOES_DE_ATALHO`.** Todas as ações abaixo já têm emissor
pronto; falta a entrada no catálogo, o `case` no `switch` e a tecla padrão. Use
os grupos do EDHPlay, que são bons:

| Grupo            | Ações a adicionar (emissor que já existe)                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mesa             | ver grimório (`searchZone`), ver X do topo (`peek`/`scry`), ver X do fundo, virar moeda (`flipCoin`), rolar d20 (`rollDice`), criar ficha (`createToken` → abre `TokenPicker`), avançar fase (`setTurn`), vida ±1 (`setLife`), alternar chat (`logAberto`), alternar trilho de oponentes, alternar barra de ações, apagar minhas setas (`clearArrows`), limpar dano (`clearDamage`), selecionar tudo no campo |
| Carta no hover   | girar dupla face (`transform` — hoje só `X`), cópia de ficha (`copyCard`), desenhar seta (`arrow`), mover para mão (`changeZone HAND`), exílio, campo, topo do grimório, fundo do grimório, conjurar comandante (`castCommander`), abrir editor de marcadores (`setEditingCard`)                                                                                                                              |
| Contadores e P/T | incrementar/decrementar/dobrar todos os marcadores (`batchCounter`), +1/+1 e −1/−1 diretos (`addCounter`), incrementar/decrementar poder e resistência (`setPt`) — o EDHPlay usa `Ctrl+1/2/3` e `Alt+1..4`                                                                                                                                                                                                    |
| Seleção múltipla | as mesmas de movimentação, em lote (`batchUpdate` / loop de `changeZone`) — o `SelectionBar` já faz, sem tecla                                                                                                                                                                                                                                                                                                |
| Foco de jogador  | 1–6 (`setBoardView`)                                                                                                                                                                                                                                                                                                                                                                                          |
| Reações          | depende de II.15                                                                                                                                                                                                                                                                                                                                                                                              |

Duas notas de implementação:

- O `EXIGE_SELECAO` em `net/atalhos.ts` é derivado do grupo `SELECAO` do
  catálogo. Ao adicionar grupos novos, revise essa derivação — hoje ela assume
  que todo `SELECAO` exige seleção, exceto `LIMPAR_SELECAO`.
- Ação nova em `ACOES_DE_ATALHO` chega com tecla de fábrica para quem já
  remapeou, porque `resolverAtalhos` completa o que falta. Isso já está testado.
- **Onde ficar melhor:** o editor pode mostrar, ao lado de cada ação, se ela
  está alcançável por menu/botão também. Uma ação só-por-tecla que o jogador
  desligou vira uma função inacessível, e nenhum dos dois produtos avisa.

### II.15 Mesa — aleatoriedade, reações, cronômetro · 🟡

| Item                     | EDHPlay                                            | AetherTable                                                                                            |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Moeda                    | ✅                                                 | 🟢 `flipCoin` + `SorteioOverlay` animado para a mesa inteira                                           |
| Dados                    | d4 d6 d8 d10 d12 d20 d100 + **dado customizado**   | 🟡 `DICE_SIDES` tem `[2,4,6,8,10,12,20,100]` e a UI expõe 7 (**sem d2**); sem XdY, sem modificador     |
| Freio de spam            | ✅ (implícito)                                     | 🟢 `limitadorDeSorteio` 5 por 8 s, no servidor, com contador visível na UI                             |
| Sorteio de jogador/carta | ✅                                                 | 🟢 `randomPlayer`, `randomCard`, `discardRandom`, todos por CSPRNG                                     |
| Reações / emotes         | ✅ 4 (👍, pensando, uau, choro) com teclas 7/8/9/0 | 🔴 **não existe** (só chat e ping)                                                                     |
| Cronômetro de turno      | ✅ interruptor na sala                             | 🔴 não existe                                                                                          |
| Desfazer                 | 🔴 não tem                                         | 🟢 `services/undo.ts` com janela de 10 s, snapshot por jogador e **30 ações declaradas irreversíveis** |

**Plano:** d2 na UI (uma linha), dado customizado XdY, reações como parte de
II.14 (uma intenção `INTENT_REACTION` efêmera, broadcast + overlay, sem estado —
o `SorteioOverlay` já é o molde), cronômetro junto da fatia 3b.

### II.16 Configurações e i18n · 🔴 no i18n

**EDHPlay:** 5 abas (Geral, Jogo, Protetores, Playmats, Placas). Idioma da
interface (6) **e idioma das cartas (7), independentes**. O FAQ é explícito:
_"o texto das cartas está disponível em inglês, espanhol, italiano, alemão,
francês e português do Brasil — configure em Configurações, separado do idioma
do site."_

**AetherTable:** 2 abas (Perfil, Cosméticos). Ver I.6 — o idioma não faz nada.
🔴 Sem idioma de carta. 🔴 Sem aba de tema (`UserPreference.theme` morto), sem
aba de áudio (`voiceMode`, `pttKey`, `masterVolume` mortos), sem privacidade,
sem notificações, sem conta (senha/e-mail/excluir), sem bloqueados, sem sessões.
⚠️ O editor de atalhos existe e só é alcançável **de dentro da mesa** — quem
quer remapear antes de jogar não encontra.

**Plano:**

1. **Decidir o i18n.** Se sim: `next-intl` com `[locale]` no App Router, e o
   `language` da conta passa a ser a fonte. Se não: o campo sai da UI. Não deixe
   como está.
2. **Idioma das cartas é independente e mais barato que o i18n da interface** —
   e é o que mais importa para um brasileiro jogando Magic. O caminho já está
   quase todo pronto: `DeckCard.scryfallId` é impressão absoluta, `ScryflallCard.lang`
   existe, `CardCache.lang` existe, `PrintingPicker` já lista impressões. Falta:
   preferência de idioma na conta, filtro `lang:` na busca de impressões, e
   preferir a impressão no idioma escolhido ao hidratar. **Nota de cuidado:**
   trocar o idioma **não pode** trocar o `scryfallId` gravado no deck sem o
   jogador pedir — é a impressão dele. A preferência vale para o que é
   **exibido** e para o que a busca **sugere**.
3. **Mover o editor de atalhos para as Configurações também**, mantendo-o no
   `TableMenu`. Mesmo componente, dois lugares.
4. Aba de conta com trocar senha, excluir conta (`UsersService.softDelete` já
   existe **sem rota**) e exportar meus dados (LGPD).
5. Aba de áudio ligando `voiceMode`/`pttKey`/`masterVolume` — depende de II.18.

### II.17 Cosméticos e monetização · 🟡 no catálogo, ⚠️ no gate

**EDHPlay:** 17 sleeves (5 grátis / 12 Patreon), 12 playmats (5/7), 8 placas de
nome (1/7), com filtro Todos/Grátis/Patreon, crédito de artista por item, e
Patreon ligado de verdade ("Obter meus benefícios do Patreon", benefícios
ativam na hora).

**AetherTable:** 8 sleeves, 6 playmats, 6 bordas de perfil, 6 títulos de chat,
6 pets — **32 itens contra 37**, e com duas categorias que o EDHPlay não tem
(bordas animadas de avatar e pets na mesa). 🟢 Todos procedurais: zero bytes de
asset, nitidez em qualquer resolução, funciona offline, nenhuma arte de terceiros
para revisar. É uma decisão melhor que a do EDHPlay.

⚠️ Mas o gate não existe — ver I.1. E não há Patreon, Stripe, tier de usuário,
loja, nem `CosmeticType.PET` no enum do Prisma (pets não são registráveis como
concedíveis).

**Plano:** I.1 primeiro. Depois, se houver monetização: `User.supporterTier`,
webhook do provedor, e o `Cadeado` passa a ser real. Se não houver: catálogo
todo gratuito e o `Cadeado` sai. **Onde ficar melhor:** crédito de artista não se
aplica (é procedural), mas **um cosmético desbloqueável por conquista** — jogar
N partidas, montar um deck válido em X formatos — é possível assim que II/I.5
gravar `MatchSummary`, e não custa integração de pagamento.

### II.18 Voz e comunicação · 🟡

**EDHPlay:** integração Discord — "Fale com seus Oponentes" cria canal de voz
automático; comunicação (Voz / Apenas chat) é campo de criação de sala e filtro
do lobby.

**AetherTable:** LiveKit embutido (`net/voice.tsx`, `VoiceBridge`), com mute
(botão na `ActionBar`) e indicador de quem fala (borda âmbar no `LifePanel`,
ícone no `PlayersModal`). 🟢 **Voz dentro do produto é melhor que mandar o
jogador para o Discord** — não exige conta em terceiro nem trocar de janela.

🔴 Falta: push-to-talk (`pttKey` está no banco), volume (`masterVolume` está no
banco), seleção de dispositivo, mute de terceiro na minha tela, indicador de
nível. Os três primeiros são colunas mortas esperando UI.

**Plano:** aba de áudio nas Configurações (II.16.5) ligando as três colunas;
mute local de participante (LiveKit suporta por participante); PTT com a tecla
vinda do catálogo de atalhos, que agora sabe remapear.

### II.19 Espectador · 🔴

**EDHPlay:** salas públicas podem ser assistidas — vê os campos em tempo real,
sem as zonas ocultas; o dono pode desativar. É o que faz sala cheia continuar
útil na lista.

**AetherTable:** não existe. Marcado V2 nos docs (F38, CDU10). O que existe é
melhor que nada: **o modelo de visibilidade já é seguro para o caso** —
`schema/visibility.ts:podeVer` tem 7 cláusulas e falha fechada, e
`visibility.spec.ts:125` já testa que um sid que não é dono nem controlador
nunca vê zona oculta.

**Plano:** um papel de espectador no `Player` (ou um `Set` de sessões
espectadoras fora do `players`), `allowSpectators` na config da sala (fatia 3a),
assento sem `seatToken` de jogador, e a garantia de que espectador nunca entra
em `zoneOrder` nem recebe `@view()`. Depende de II.2 para ter onde clicar
"Assistir". **Cuidado:** enquanto isso não existir, o botão "Assistir" da lista
deve ficar **desabilitado com o motivo escrito**. Um botão que promete o que
não existe é pior que um botão ausente.

### II.20 Moderação e segurança · 🟢 muito melhor, com furos

**EDHPlay:** expulsar (votação da mesa, dono remove direto), denunciar (vai à
moderação), denúncia em comentário de deck.

**AetherTable:** um backoffice completo que o EDHPlay não expõe — 6 telas de
admin, papéis `USER/MOD/ADMIN` lidos **do banco a cada requisição** (não do
JWT), suspender com prazo e motivo obrigatório (min 8 chars), banir (soft
delete), restaurar, mudar papel, denúncias com snapshot congelado e triagem em
três estados, `AuditLog` com 15 tipos de ação e sem rota de update/delete, três
feature flags, travas contra auto-ação e contra remover o último ADMIN,
bootstrap de admin por env. 🟢 **Não regrida nada disso.**

Furos: I.2 (monitor exposto), `Block` sem uso, kick não registrado em auditoria,
sem expurgo LGPD, sem notificação ao denunciante nem ao punido, sem ban por
sala, sem filtro de linguagem no chat, throttler em memória (I.8).

**Onde ficar melhor:** a **votação de expulsão** do EDHPlay é uma boa ideia que
o AetherTable não tem — hoje só o anfitrião expulsa, o que significa que numa
mesa de quatro o anfitrião é juiz único. Uma votação (`INTENT_VOTE_KICK`) com
maioria simples, além do poder do anfitrião, é barata e resolve o caso do
anfitrião ausente ou ele próprio sendo o problema.

### II.21 Ajuda e FAQ · 🔴

Ver II.1.4. O EDHPlay tem 22 perguntas em 6 seções, um guia "como jogar
Commander online", Discord, Reddit, Patreon, Merch, Colaboradores, Kit de
Imprensa, Contato. O AetherTable não tem uma única rota de ajuda.

O caminho melhor já está descrito em II.1.4: **gerar a ajuda a partir das
constantes** (30 presets de formato, catálogo de atalhos, catálogo de
cosméticos, 17 códigos de legalidade) em vez de escrever texto que envelhece.

### II.22 Mobile e PWA · 🔴

**EDHPlay:** _"A mesa roda em qualquer navegador móvel moderno, na horizontal.
Vire o celular e você tem o tabuleiro completo com as gavetas de zona feitas
para toque, e dá para instalar na tela de início como um app."_

**AetherTable:**

- 🔴 Sem `manifest`, sem service worker, sem `next-pwa`, sem ícones, sem
  `themeColor`, sem `appleWebApp`, **sem `export const viewport` nem
  `<meta viewport>`**.
- 🔴 **Zero handlers de toque explícitos** em todo `apps/frontend/src`: nenhum
  `onTouchStart`, `touchmove`, `onPointerDown`, `pinch`, `(pointer: coarse)`. O
  arraste de carta funciona só pelo suporte nativo do Konva.
- ⚠️ `ContextMenu` e `CameraControls` são de mouse/teclado; **`CardHoverPreview`
  depende de `hover`, que não existe em toque** — e é `lg`-only, então no
  celular não há prévia de carta de jeito nenhum.
- 🟡 O que existe de verdade: `min-h-dvh`/`h-dvh` (não `vh`), gaveta mobile no
  dashboard, `estreito` via `matchMedia('(min-width: 640px)')` ajustando a
  geometria da mesa, `ChatLog` nascendo recolhido no mobile, e **E2E em dois
  perfis (Desktop Chrome + Pixel 7)** verificando ausência de estouro horizontal.

**Plano, em ordem:**

1. `export const viewport` com `width=device-width, initial-scale=1` +
   `themeColor`. **Uma linha e é a diferença entre a mesa caber e não caber.**
2. `manifest` + ícones + `display: standalone` + `orientation: landscape` para a
   rota da mesa.
3. **Long-press abrindo o menu de contexto.** Sem isso, metade das ações da mesa
   é inalcançável no celular.
4. Prévia de carta por **toque** (tap longo ou tap num ícone), substituindo o
   `hover` que não existe — e removendo o `hidden lg:flex`.
5. Gavetas de zona por toque, como o EDHPlay descreve.
6. Service worker só depois: cachear a casca de um jogo em tempo real dá pouco,
   e cache errado numa mesa sincronizada dá bug difícil.

### II.23 Operação · 🟡

🟢 CI completo (`schema:check`, lint, typecheck, test, build, E2E Playwright com
upload de relatório), `render.yaml` versionado, health nos dois serviços,
métricas Prometheus no game-server, feature flags, `nestjs-pino`, helmet,
throttler, `InternalApiGuard`, Swagger só fora de produção.

🔴 Falta: CD (nenhum workflow de deploy), staging, smoke test pós-deploy,
alertas, error tracking (Sentry/OTel), `/metrics` na API Core, **auth no
`/metrics` e no `/colyseus`** (I.2), frontend no `render.yaml`, Redis no
blueprint, backup documentado, e **qualquer cron/scheduler** — o que bloqueia o
expurgo LGPD e a limpeza de salas.

---

## Parte III — Onde o AetherTable já é melhor. Não regredir.

Se alguma proposta acima colidir com um destes, o item desta lista ganha.

1. **Motor de legalidade** — 17 códigos de achado com gravidade, erro que
   bloqueia a mesa separado de aviso, mesma função no cliente e no servidor, ~45
   testes. O EDHPlay diz "Válido".
2. **Visibilidade por carta com `@view()`** — `Card.scryfallId` é invisível por
   padrão e liberado por inscrição, com `podeVer` de 7 cláusulas e falha
   fechada. É segurança de informação oculta feita no schema, não na UI.
3. **Desfazer** — janela de 10 s, snapshot por jogador, **30 ações declaradas
   irreversíveis** e a regra de que uma ação irreversível apaga o snapshot. O
   EDHPlay não tem desfazer.
4. **Consentimento para ver zona oculta** — `INTENT_REQUEST_VIEW` /
   `RESPOND_VIEW` / `REVOKE_VIEW`, com "vendo junto" listado e revogável por
   observador. É melhor que revelar a mão para todos.
5. **Scry e surveil transacionais** — `ScryModal` reordena e confirma, em vez de
   mover carta por carta.
6. **30 presets de formato** com regras reais (singleton, teto de raridade,
   reserva, comandante, valor de mana) contra 14 nomes de formato.
7. **Backoffice** — papéis do banco a cada requisição, auditoria imutável de 15
   ações, travas contra auto-ação e contra remover o último admin.
8. **Cosméticos procedurais** — zero asset, nitidez em qualquer resolução,
   offline, nenhuma arte de terceiros. Mais bordas animadas e pets, que o
   EDHPlay não tem.
9. **Voz embutida (LiveKit)** em vez de empurrar para o Discord.
10. **Anexos desenhados, setas com âncora em jogador, e pings.**
11. **Freio de sorteio no servidor** (5 por 8 s) com contador visível.
12. **Atalhos remapeáveis com gramática canônica** — caixa preservada,
    `ctrl`/`meta` colapsados, alias de ABNT2, conflito nomeado. Melhor mecanismo
    que o do EDHPlay; falta popular o catálogo (II.14).
13. **`tools/schema-sync.mjs` + `mirror.spec.ts` + `tools/estado-implementacao.mjs`**
    — três ferramentas que impedem classes inteiras de bug. Rode-as sempre.

---

## Parte IV — Ordem de execução

Cada fase é um commit (ou poucos). A ordem respeita dependências reais.

### Fase A — Furos e segurança (antes de qualquer recurso)

1. I.4 banner de dummy keys · I.8 placeholder do código da sala · II.4 nome do
   formato em vez do id. _(minutos, sem risco)_
2. I.2 fechar `/colyseus` e `/metrics`, e corrigir o texto da tela de admin.
3. I.1 gate de cosmético: `disabled` real + recusa no DTO + `revogarCosmetico`
   limpando as colunas certas.
4. I.3 token fora da querystring + logout que revoga.
5. I.5 gravar `MatchSummary` no `onDispose` via rota interna. **Desbloqueia toda
   estatística de jogador.**
6. I.6 decidir o idioma: i18n de verdade ou remover o campo.

### Fase B — Barreira de entrada

7. II.22.1 `viewport` + `themeColor`. _(uma linha, alto impacto)_
8. II.9 decks iniciais (5 a 10, via o parser de import que já existe) + deck
   aleatório.
9. II.1 landing em `/`, login em `/login`, `/demo` solo sem conta,
   `GET /online`, termos/privacidade/Fan Content.
10. II.1.4 + II.21 `/ajuda` gerada dos presets e do catálogo de atalhos.

### Fase C — Deckbuilder

11. II.3.1–3 identidade de cor, comandante e favorito (três colunas que já
    existem no schema e nunca foram escritas).
12. **II.4.1 painel de estatísticas** — curva de mana, tipos, requisitos de cor
    **sobrepostos às fontes de mana**, top de preço, palavras-chave. SVG inline,
    sem biblioteca.
13. II.7 exportar (texto com/sem impressões, MTGA, JSON) + importar aditivo +
    respeitar `SIDEBOARD`.
14. II.4.2 UI de sideboard e fichas.
15. II.5 ligar o autocomplete órfão + filtros estruturados + "só o que é legal
    neste deck" + paginação + "já no deck".
16. II.4.3 prévia com oracle text reaproveitando o `CardHoverPreview`.
17. II.6 bracket por Game Changers oficial.

### Fase D — Salas

18. **Fatia 3a** — `ConfigDeSala`, `setMetadata`, `GET /salas`, browser com
    filtros. _(spec pronta em `claude/fatia-3-configuracao-de-sala.md`)_
19. **Fatia 3b** — lobby: mulligan, jogador inicial, ordem de assentos (dando UI
    ao `INTENT_SET_TURN_ORDER` órfão), sideboard, cronômetro, **e o sorteio de
    quem começa** (hoje o anfitrião começa sempre).
20. II.2 "voltar à partida" com reemissão de passe.
21. II.19 espectador.

### Fase E — Mesa

22. **II.14 expandir `ACOES_DE_ATALHO` de 13 para ~35.** Todos os emissores já
    existem.
23. II.13 submenus + menu de contexto em carta de cemitério/exílio/reserva +
    menu de jogador.
24. II.12 rastreador de mana.
25. II.15 reações, d2, dado XdY.
26. II.11 decidir os layouts órfãos: ligar `montarMesa`/`montarGrade` no
    `ExibicaoControls` ou removê-los com o atalho.
27. II.22.3–5 long-press, prévia por toque, gavetas de zona.

### Fase F — Social e i18n

28. II.8 deck público, `/explorar`, "jogar este deck", comentários.
29. II.16.2 idioma das cartas.
30. II.16.1 i18n da interface (se a decisão da Fase A foi "sim").
31. II.18 aba de áudio: PTT, volume, dispositivo, mute local.
32. II.20 votação de expulsão, kick em auditoria, expurgo LGPD (exige scheduler).

---

## Parte V — Verificação, sempre nesta ordem

```
pnpm --filter "@aethertable/shared-types" build
pnpm schema:check          # mirror do Colyseus em sincronia
pnpm docs:estado           # paridade de intenções tem de fechar
pnpm typecheck             # backend-core exige prisma generate uma vez
pnpm lint
pnpm test
cd apps/frontend && npx next build
pnpm --filter frontend test:e2e
```

Cada fase precisa de teste, e o repositório já mostra onde eles moram:

- regra pura → spec em `packages/` ou no consumidor (`legalidade.spec.ts`,
  `atalhos.spec.ts`, `mesa-focada.spec.ts`);
- intenção → spec em `apps/game-server/src/intents/*.spec.ts`, **com UUID real e
  payload que o zod de fato valida** — foi assim que `zonas.spec.ts` pegou o
  `+1/+1` que o servidor recusava em silêncio;
- tela pública → `apps/frontend/e2e/`, nos dois perfis (Desktop + Pixel 7).

E o push do branch, que ainda não foi feito:

```
git push -u origin feat/preferencias-de-mesa
```

---

## Nota sobre este documento

O que está aqui saiu de duas fontes verificáveis: o levantamento do EDHPlay em
sessão autenticada (v0.4.17, 08/09/2026) e uma auditoria de código arquivo por
arquivo do AetherTable. Onde eu não confirmei algo, está dito no texto — por
exemplo, não testei o remapeamento de atalhos do EDHPlay, só li o painel dele, e
não consegui capturar a lista de resultados da busca de cartas dele (renderiza
como grade de imagens sem texto).

Os itens marcados ⚠️ são os que eu trataria primeiro, e não porque o EDHPlay
tem algo: são lugares onde o schema ou a interface do AetherTable **promete o que
o código não faz**. Um cadeado que não tranca, um logout que não desloga, um
seletor de idioma que não muda idioma e um contador de partidas que é sempre
zero custam mais confiança do que qualquer recurso ausente.
