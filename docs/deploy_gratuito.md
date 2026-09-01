# Deploy Gratuito (Free Tier)

| Campo                       | Valor                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ID**                      | `DOC-055`                                                                                                                                                                                        |
| **Versão**                  | 1.0                                                                                                                                                                                              |
| **Status**                  | Ativo                                                                                                                                                                                            |
| **Última revisão**          | 2026-08-24                                                                                                                                                                                       |
| **Documentos relacionados** | [stack_tecnologico.md](stack_tecnologico.md) · [devops_e_infraestrutura.md](devops_e_infraestrutura.md) · [guia_de_configuracao_e_desenvolvimento.md](guia_de_configuracao_e_desenvolvimento.md) |

> Este documento descreve como colocar o AetherTable no ar **sem custo mensal**.
> Ele não substitui [devops_e_infraestrutura.md](devops_e_infraestrutura.md), que descreve o alvo de
> produção. É o caminho para demonstrar, testar com amigos e validar o produto antes de gastar.

---

## 1. O que é possível e o que não é

**É possível** subir a aplicação inteira de graça e jogar uma partida de 4 pessoas.

**Não é possível** eliminar a hibernação. Todo plano gratuito de container derruba o processo após
alguns minutos sem tráfego. Isso produz um comportamento específico que precisa ser entendido antes
de escolher este caminho:

| Situação                                    | O que acontece                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Partida em andamento                        | **Nada.** O patch de 20 Hz mantém o serviço acordado enquanto alguém joga |
| Primeira conexão após ~15 min ociosos       | **~50 s de espera** enquanto o container sobe                             |
| Reconexão dentro da janela de 90 s (`RN10`) | Normal, o serviço está quente                                             |

A espera não é eliminável no plano gratuito — só é possível torná-la legível. É o que
`apps/frontend/src/net/wake.ts` faz: detecta que a chamada está pendurada, avisa "acordando o
servidor" e repete com backoff. Sem isso, o usuário clica em "Entrar", nada acontece e ele conclui
que o site está quebrado.

> **O aviso de `ADR-002` continua valendo:** _serverless_ (Lambda, Cloud Functions, Vercel Functions)
> segue **inviável** para o game server. O que usamos aqui é um **container de longa duração no plano
> gratuito** — coisa diferente de serverless. Ele hiberna, mas mantém conexão WebSocket aberta
> enquanto está acordado, que é o requisito.

---

## 2. A stack gratuita

| Componente             | Serviço         | Plano            | Limite que importa                                                            |
| ---------------------- | --------------- | ---------------- | ----------------------------------------------------------------------------- |
| Frontend (Next.js)     | **Vercel**      | Hobby            | Sem hibernação. 100 GB de banda/mês                                           |
| API Core (NestJS)      | **Render**      | Free Web Service | Hiberna em ~15 min. 750 h/mês                                                 |
| Game server (Colyseus) | **Render**      | Free Web Service | Idem. WebSocket suportado                                                     |
| PostgreSQL             | **Neon**        | Free             | 0.5 GB. Autosuspend, acorda em <1 s                                           |
| Redis                  | **removido**    | —                | Ver §2.1                                                                      |
| Imagens de carta       | CDN da Scryfall | —                | Nunca hospedamos arte (`DOC-023 §1.2`) — mas o navegador busca via API (§3.6) |
| Voz (LiveKit)          | LiveKit Cloud   | Free             | 50 GB/mês. Opcional — a mesa funciona sem voz                                 |

### 2.1 Por que o Redis sai

O Redis existe na arquitetura para **três** coisas (`DOC-022 §4.3`): _rate limiting_ distribuído,
presence/driver do Colyseus entre nós, e `sessionId` de reconexão entre nós.

As três só importam com **mais de um nó**. O plano gratuito é de um nó só. Com `USE_REDIS=false` o
Colyseus usa presence local em memória, que é correto — e mais rápido — para um processo único.

**Quando voltar a precisar:** ao subir para dois ou mais nós de game server. Aí o Redis deixa de ser
opcional e vira obrigatório, sob pena de um jogador entrar num nó que não hospeda a sala dele.

O Upstash tem plano gratuito (10 mil comandos/dia) caso queira testar o caminho multi-nó, mas 10 mil
comandos/dia não sustentam presence de verdade.

---

## 3. Passo a passo

### Passo 1 — Banco no Neon

1. Crie uma conta em [neon.tech](https://neon.tech) e um projeto.
2. Copie a connection string **pooled** — o host contém `-pooler`.

> **Use a pooled, não a direta.** O Prisma abre um pool de conexões por instância; o limite de
> conexões diretas do plano gratuito se esgota rápido e o sintoma é
> `too many connections` intermitente, difícil de reproduzir.

A URL precisa terminar com `?sslmode=require`:

```
postgresql://USUARIO:SENHA@ep-xxx-pooler.us-east-2.aws.neon.tech/aethertable?sslmode=require
```

### Passo 2 — Serviços no Render

O arquivo [`render.yaml`](../render.yaml) na raiz é um _blueprint_: o Render lê ele e cria os dois
serviços já configurados.

1. No Render: **New → Blueprint** e aponte para o repositório.
2. Preencha as variáveis marcadas como `sync: false` (o Render pergunta):

| Variável              | Serviço | Valor                                                    |
| --------------------- | ------- | -------------------------------------------------------- |
| `DATABASE_URL`        | api     | A pooled string do Neon                                  |
| `CORS_ORIGINS`        | api     | A URL da Vercel — **só existe depois do Passo 3**        |
| `FRONTEND_URL`        | api     | A mesma URL da Vercel (destino do redirect de OAuth)     |
| `SCRYFALL_USER_AGENT` | api     | `AetherTable/1.0 (+seu-email)`                           |
| `LIVEKIT_URL`         | api     | `wss://…livekit.cloud` — deixe vazio se não for usar voz |
| `LIVEKIT_API_KEY`     | api     | Do LiveKit Cloud — idem                                  |
| `LIVEKIT_API_SECRET`  | api     | Do LiveKit Cloud — idem                                  |
| `JWT_SECRET`          | game    | **Copiado** do valor gerado no serviço `api`             |
| `INTERNAL_API_TOKEN`  | game    | **Copiado** do valor gerado no serviço `api`             |
| `PUBLIC_WS_URL`       | game    | `wss://aethertable-game.onrender.com`                    |

> **Dois segredos precisam ser IDÊNTICOS nos dois serviços.** O `render.yaml` os gera no serviço da
> API (`generateValue`) e deixa o campo do game server em branco; copiar é manual, e é onde o deploy
> costuma morrer:
>
> | Segredo              | Se divergir                                                                                                                                                  |
> | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
> | `JWT_SECRET`         | `Invalid seat token` no handshake — a mesa nunca abre. É o erro nº 1 de quem monta o ambiente (`DOC-054 §9`)                                                 |
> | `INTERNAL_API_TOKEN` | Pior, porque é **silencioso**: o game server toma 401 ao buscar o decklist, a partida começa e a mesa abre **vazia**, sem nenhum erro visível para o jogador |

> **A ordem tem um nó.** `CORS_ORIGINS` e `FRONTEND_URL` pedem a URL da Vercel, que só nasce no Passo
> 3 — e o Passo 3 pede as URLs do Render, que nascem aqui. Preencha os dois com um valor provisório
> (`https://exemplo.vercel.app` serve), termine o Passo 3 e volte no Passo 4 para corrigir. Deixar em
> branco não é opção: o serviço sobe e o login falha com erro de CORS.

As migrations rodam sozinhas: o `CMD` da imagem executa `prisma migrate deploy` antes de subir a
API. É idempotente — aplica só o que está pendente.

### Passo 3 — Frontend na Vercel

1. **Add New → Project**, aponte para o repositório.
2. **Root Directory:** `apps/frontend`.
3. A Vercel detecta o Next.js e o monorepo pnpm sozinha.
4. Variáveis de ambiente:

```env
NEXT_PUBLIC_API_URL=https://aethertable-api.onrender.com/api/v1
NEXT_PUBLIC_WS_URL=wss://aethertable-game.onrender.com
```

> `wss://`, não `ws://`. Em página servida por HTTPS o navegador **bloqueia** WebSocket inseguro, e o
> erro no console fala de _mixed content_, não de WebSocket — o que manda a investigação para o lado
> errado.

### Passo 3.6 — Por que a API precisa estar no ar para as cartas aparecerem

O navegador **não** busca mais arte em `cards.scryfall.io`. Ele pede tudo à API
(`GET /api/v1/cards/img/:id`), que reencaminha. Isso existe para redes que filtram domínio —
escola, empresa, órgão público — onde a chamada direta do navegador nem sai e a mesa aparece
inteira em branco, sem erro no console que aponte a causa.

Consequência: **quem precisa alcançar a Scryfall passou a ser o servidor**, não o cliente.

| Onde a API roda                     | Resultado                                           |
| ----------------------------------- | --------------------------------------------------- |
| Render (fora da rede filtrada)      | Funciona, inclusive para quem acessa de dentro dela |
| `localhost` dentro da rede filtrada | **Não funciona** — o backend toma o mesmo bloqueio  |

Não adianta subir o código para o GitHub e rodar `pnpm dev` na máquina de dentro da rede: o
proxy só muda o problema de lugar. Se a rede também bloquear o host da API, aponte
`SCRYFALL_API_URL` e `SCRYFALL_IMAGE_URL` para um espelho liberado.

> `NEXT_PUBLIC_API_URL` é substituída em tempo de **build** pelo Next. Mudar o valor na Vercel
> sem redeployar não tem efeito nenhum — o valor antigo já está dentro do bundle.

### Passo 4 — Fechar o CORS

Com a URL final da Vercel em mãos, volte no Render e corrija **as duas** variáveis que ficaram
provisórias no Passo 2, no serviço da API:

- `CORS_ORIGINS` — exatamente a origem da Vercel, sem barra no fim;
- `FRONTEND_URL` — a mesma URL. É para onde o backend devolve o navegador depois do OAuth; apontando
  para o lugar errado, o login pelo Google/Discord termina numa página que não é a sua.

Não use `*` em `CORS_ORIGINS`: com `credentials: true` o navegador **rejeita** a resposta se o
`Access-Control-Allow-Origin` for curinga. O sintoma é um erro de CORS no login que não menciona
credenciais em lugar nenhum.

### Passo 5 — Conferir que subiu

| O que abrir                                | O que esperar                                    |
| ------------------------------------------ | ------------------------------------------------ |
| `https://…-api.onrender.com/api/v1/health` | JSON de saúde (pode levar ~50 s na primeira vez) |
| `https://…-game.onrender.com/health`       | Idem                                             |
| `https://…-api.onrender.com/api/v1/docs`   | Swagger da API                                   |
| A URL da Vercel                            | Tela de login                                    |

| `https://…-api.onrender.com/api/v1/cards/img/0dd0f3e2-3e0a-4b41-9a10-2f83e4d3b3f6` | A arte de uma carta — prova que o proxy alcança a Scryfall |

Se a mesa abrir mas o grimório vier **vazio**, o `INTERNAL_API_TOKEN` não bate entre os dois
serviços — é o único sintoma que não produz erro na tela.

Se as cartas aparecerem em branco mas o resto funcionar, abra a rota de imagem acima direto no
navegador: `503` significa que a API não alcança a Scryfall (§3.6); a arte significa que o
problema está em `NEXT_PUBLIC_API_URL` no build da Vercel.

---

## 4. Matriz de variáveis por ambiente

| Variável              | Dev local                                                      | Free tier                       |
| --------------------- | -------------------------------------------------------------- | ------------------------------- |
| `PORT` (api)          | `3333`                                                         | Injetada pelo host              |
| `PORT` (game)         | `2567`                                                         | Injetada pelo host              |
| `DATABASE_URL`        | `postgresql://postgres:password@localhost:5432/aethertable_db` | Neon pooled + `sslmode=require` |
| `USE_REDIS`           | `false`                                                        | `false`                         |
| `CORS_ORIGINS`        | `http://localhost:3030`                                        | URL da Vercel                   |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3333/api/v1`                                 | `https://…onrender.com/api/v1`  |
| `NEXT_PUBLIC_WS_URL`  | `ws://localhost:2567`                                          | `wss://…onrender.com`           |

> **Portas 3000–3020 são reservadas neste projeto** e não devem ser usadas por nenhum serviço. Por
> isso o frontend roda em **3030**, e não na 3000 convencional do Next.

---

## 5. O que se perde em relação ao alvo de produção

| Item             | Produção (`DOC-053`)   | Free tier                       |
| ---------------- | ---------------------- | ------------------------------- |
| Disponibilidade  | Contínua               | Hiberna em ~15 min ocioso       |
| Primeira conexão | Imediata               | Até ~50 s                       |
| Escala           | Multi-nó com Redis     | Um nó                           |
| Backup do banco  | PITR, janela de 7 dias | Snapshot do Neon free           |
| Observabilidade  | Prometheus + Grafana   | `/metrics` exposto, sem coletor |
| Voz              | LiveKit dedicado       | LiveKit Cloud free, 50 GB/mês   |

**O primeiro gargalo a aparecer** é a hibernação, não o banco nem a banda. Quando ela incomodar, o
passo mais barato é subir **só o game server** para um plano pago (~US$ 7/mês no Render, ou uma VPS
de ~US$ 4/mês na Hetzner). A API pode continuar no free tier por muito tempo: uma chamada REST lenta
na primeira vez é tolerável; uma mesa que demora 50 s para abrir não é.

---

## 6. Portabilidade

Os dois serviços Node são **containers** ([`apps/backend-core/Dockerfile`](../apps/backend-core/Dockerfile)
e [`apps/game-server/Dockerfile`](../apps/game-server/Dockerfile)), construídos a partir da raiz do
monorepo.

Trocar de provedor é trocar o arquivo de blueprint, não reescrever nada:

| Provedor | Arquivo                | Observação                                                                                                                              |
| -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Render   | `render.yaml`          | O que está configurado hoje                                                                                                             |
| Fly.io   | `fly.toml`             | `auto_stop_machines` acorda em ~1–2 s, bem melhor que os ~50 s do Render — mas hoje consome crédito de teste, não é gratuito permanente |
| Koyeb    | painel ou `koyeb.yaml` | Um serviço free, hiberna                                                                                                                |
| VPS      | `docker compose`       | Sem hibernação; é o alvo de `DOC-053`                                                                                                   |
