# Política de Testes

| Campo             | Valor                                      |
| ----------------- | ------------------------------------------ |
| **ID**            | `DOC-092`                                  |
| **Vale para**     | todo push e todo pull request              |
| **Executada por** | `pnpm verificar`, o hook `pre-push` e o CI |

## 1. As duas regras

> **1. Nada sobe sem a bateria passar.**
> **2. Toda modificação de comportamento acompanha o teste que a prova.**

O resto deste documento é o porquê de cada uma e como cumpri-las sem atrito.

## 2. A bateria, e o que cada passo protege

Um comando roda tudo, na ordem em que as coisas dependem umas das outras:

```bash
pnpm verificar
```

| Passo                | O que ele pega                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared-types build` | O frontend e o game-server importam o pacote pelo `dist`. Sem este passo, os outros falham por módulo ausente e o erro não fala do problema real.                                                                                                                                             |
| `schema:check`       | **O passo mais barato e o que protege o bug mais caro.** `@colyseus/schema` serializa por ÍNDICE de campo: um campo a mais no servidor desloca todos os seguintes e o cliente decodifica lixo — sem erro, sem aviso. Foi assim que `Player.mulliganCount` fez a mesa parar de receber cartas. |
| `docs:estado`        | Intenção que o cliente emite e o servidor não conhece é descartada em silêncio pelo Colyseus. O contador de paridade tem de fechar.                                                                                                                                                           |
| `lint`               | Regras de hooks do React (hook condicional já derrubou a mesa) e `no-restricted-properties`, que bloqueia `Math.random()` fora de `services/rng.ts` (RN06).                                                                                                                                   |
| `typecheck`          | O contrato entre os três apps. Mudar um campo em `shared-types` deve QUEBRAR A COMPILAÇÃO de quem não acompanhou — é o comportamento desejado.                                                                                                                                                |
| `test`               | Unidade e contrato.                                                                                                                                                                                                                                                                           |
| `build`              | `next build` pega o que o `tsc` não pega: `useSearchParams` sem Suspense já quebrou o build com typecheck verde.                                                                                                                                                                              |
| `format:check`       | Diff de formatação some no meio de diff de conteúdo.                                                                                                                                                                                                                                          |

### Antes de mexer no render ou na conexão da mesa

A bateria acima **não cobre** interação entre jogadores nem gesto de mouse.
Todos os defeitos relatados por jogador — o botão direito comprando carta, a
câmera que não trocava de mesa, o mulligan no meio da partida — passaram por
um `pnpm test` verde.

Quem toca em `GameBoard`, `useRoomSync`, `AetherRoom.onAuth/onJoin`, no caminho
de conexão de `/play/[roomId]` ou na geometria de `canvas/layout` roda também:

```bash
pnpm dev                                    # os três serviços
node apps/frontend/e2e/fixtures/preparar-jogadores.mjs
cd apps/frontend
E2E_BASE_URL=http://localhost:3030 npx playwright test --project=desktop
```

Cada suíte existe por um motivo diferente:

- **`mesa-multijogador`** (33) — quatro navegadores de verdade numa sala de
  verdade. É a única que enxerga interação entre jogadores.
- **`sala-publica-e-espectador`** (8) — a vitrine e as quatro camadas do modo
  espectador, que só se encontram em execução. Ela pegou dois defeitos que
  passaram por typecheck, lint e 353 testes de unidade: o CORS ausente no
  game-server e o `onChange` do Colyseus que não dispara retroativamente.
- **`formato-da-mesa`** (6) — os três arranjos do tabuleiro desenham de verdade.
  `montarMesa` e `montarGrade` ficaram sem chamador por vários commits sem
  nenhum teste reclamar: os dois estavam corretos, faltava alguém chamá-los.
- **`recarregar-a-pagina`** (6) — o F5 volta para a mesa. O `reconnectionToken`
  é emitido pelo servidor, guardado no `sessionStorage` e usado num handshake de
  WebSocket; as três pontas só existem juntas num navegador.
- **`telas-publicas`** (14) — o que roda sem banco e sem serviços. É a única
  que o CI executa, e é por isso que ela é assim.

### Uma suíte não pode pegar a conta de outra emprestada

`fullyParallel: true`: as suítes rodam ao mesmo tempo, em navegadores
diferentes, contra **a mesma API e o mesmo banco**. Duas suítes logadas na mesma
conta disputam preferências, decks e assentos — e `zerarPreferenciasDeMesa` de
uma apaga a preparação da outra no meio do caminho.

O sintoma não parece conflito: é um `waitForURL` estourando o tempo no primeiro
teste de uma suíte, e as outras 30 marcadas como "did not run". Parece regressão
no produto; é briga de fixture.

`preparar-jogadores.mjs` cria **cinco**: os quatro primeiros são a mesa de
`mesa-multijogador`, e `aether_elo` é o avulso. **Uma suíte nova de um jogador
só usa `aether_elo`** — não um dos quatro. Se uma segunda suíte de um jogador só
aparecer, acrescente um sexto em vez de compartilhar.

## 3. Por que o E2E completo não roda no CI

Ele exige Postgres, API e game-server no ar, mais uma dúzia de chamadas à
Scryfall. Num runner, isso é lento e instável — e **uma suíte que falha ao
acaso vira uma suíte ignorada**, o que é pior que suíte nenhuma: ela dá a
impressão de cobertura enquanto ninguém mais lê o resultado.

Por isso ela é opt-in por `E2E_BASE_URL` e pula inteira sem ele. O preço é que
alguém precisa rodá-la de propósito; a regra acima diz quando.

## 4. Toda modificação acompanha o teste que a prova

Não é cerimônia. É a diferença entre "eu testei na mão" e "isto continua
funcionando daqui a seis meses, quando outra pessoa mexer perto".

| Você mudou                       | O teste vai em                                      |
| -------------------------------- | --------------------------------------------------- |
| Handler de intenção              | `apps/game-server/src/intents/*.spec.ts`            |
| Regra de formato / legalidade    | `packages/shared-types` → spec no frontend          |
| Rota da API                      | `apps/backend-core/src/**/*.spec.ts`                |
| Campo do `RoomState`             | `pnpm schema:sync` — `mirror.spec.ts` cobre o resto |
| Interação de mesa, gesto, render | `apps/frontend/e2e/mesa-multijogador.spec.ts`       |
| Correção de defeito              | **o teste que falha ANTES da correção**             |

### Um teste por "não pode", não por linha

O que some numa refatoração sem nada quebrar visivelmente é a regra que diz
**quando uma ação é impossível** — mulligan depois de a partida começar,
espectador mexendo na mesa, convidado reescrevendo as regras. Cobertura de
linha não pega nenhuma delas; um `it` que fixa o "não pode", sim.

### Escreva o teste sobre a invariante, não sobre o exemplo

Um caso real deste repositório: o E2E afirmava `A vez é de aether_ana` porque
a anfitriã começava sempre — e ela começava sempre porque
`INTENT_START_MATCH` fazia `activePlayerId = eu.id`, uma vantagem silenciosa
do anfitrião que ninguém tinha combinado. O teste passou a ser "exatamente um
jogador passa o turno, e os outros apontam para ele", que é o que ele sempre
quis dizer — e que também pega dois botões habilitados ao mesmo tempo, coisa
que a versão antiga não pegava.

### Fixture realista, sempre

`zonas.spec.ts` usa UUIDs de verdade e payloads que o zod de fato valida. Foi
assim que ele pegou o `+1/+1` que o servidor recusava em silêncio: uma fixture
com `id: 'carta-1'` teria passado no handler e falhado só em produção.

## 5. Quando um teste falha

Nesta ordem, e a ordem importa:

1. **Entenda o que ele afirma.** A mensagem e o comentário dizem qual defeito
   ele existe para pegar.
2. **Decida quem está errado.** Se o comportamento novo é o certo, o teste
   estava codificando o comportamento antigo — e a correção é reescrevê-lo
   sobre a invariante, com um comentário dizendo o que mudou e por quê.
3. **Nunca afrouxe a asserção para o teste passar.** Trocar `toBe` por
   `toBeTruthy`, subir um timeout ou remover um `expect` transforma o teste em
   decoração.
4. **`test.skip` precisa de um porquê escrito e de um prazo.** Um skip sem
   nota é um teste apagado com passos extras.

## 6. Onde a bateria roda sozinha

| Momento                       | O quê                                 | Onde                       |
| ----------------------------- | ------------------------------------- | -------------------------- |
| `git commit`                  | ESLint + Prettier nos arquivos staged | `.husky/pre-commit`        |
| `git push`                    | A bateria completa                    | `.husky/pre-push`          |
| PR e push em `main`/`develop` | Bateria + build + E2E público         | `.github/workflows/ci.yml` |

O hook de push existe porque o CI descobre tarde: o custo de um push quebrado
é o tempo de todo mundo que puxou a branch nesse meio-tempo. Ele é o mesmo
comando que você roda à mão — só que sem depender de você lembrar.

### `--no-verify`

Existe, e é para quando você sabe exatamente por que está pulando. Se virar
hábito, o problema é a bateria estar lenta ou instável demais — e isso se
conserta na bateria, não no hábito.

## 7. Documentos irmãos

- **DOC-090** — [Estado de Implementação](estado_de_implementacao.md): gerado,
  não escrito. Paridade entre contrato, servidor e cliente.
- **DOC-091** — [Fluxo de Trabalho Git](fluxo_de_trabalho_git.md)
- **DOC-093** — [Política de Documentação](politica_de_documentacao.md)
- [Plano de Testes e Qualidade](plano_de_testes_e_qualidade.md): a pirâmide e
  as metas de cobertura. Este documento aqui é o processo; aquele é a
  estratégia.
