# Stack Tecnológico e Ferramentas

**Projeto:** AetherTable (Sandbox MTG)

| Campo                       | Valor                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**                      | `DOC-022`                                                                                                                                                                                                                                                               |
| **Versão**                  | 1.1                                                                                                                                                                                                                                                                     |
| **Status**                  | Estável                                                                                                                                                                                                                                                                 |
| **Última revisão**          | 2026-08-20                                                                                                                                                                                                                                                              |
| **Documentos relacionados** | [readme.md](readme.md) · [documento_de_arquitetura_de_software_sad.md](documento_de_arquitetura_de_software_sad.md) · [guia_de_configuracao_e_desenvolvimento.md](guia_de_configuracao_e_desenvolvimento.md) · [devops_e_infraestrutura.md](devops_e_infraestrutura.md) |

---

## 1. Resumo executivo da stack

| Camada                | Escolha                            | Versão-alvo        | Decisão em |
| --------------------- | ---------------------------------- | ------------------ | ---------- |
| Framework web         | Next.js (App Router) + React       | 15.x / 19.x        | —          |
| Linguagem             | TypeScript                         | 5.5+               | `ADR-008`  |
| Estilo                | Tailwind CSS                       | 4.x                | —          |
| Motor gráfico da mesa | React Konva + Konva                | 19.x / 9.x         | `ADR-003`  |
| Estado local          | Zustand                            | 5.x                | —          |
| Cliente de tempo real | colyseus.js                        | 0.16.x             | `ADR-002`  |
| Runtime backend       | Node.js LTS                        | 22.x               | `ADR-008`  |
| API REST              | NestJS                             | 11.x               | —          |
| Servidor de jogo      | Colyseus                           | 0.16.x             | `ADR-002`  |
| Voz                   | LiveKit (SFU)                      | Cloud / server 1.x | `ADR-005`  |
| ORM                   | Prisma                             | 6.x                | —          |
| Banco                 | PostgreSQL                         | 16.x               | —          |
| Cache / presença      | Redis                              | 7.x                | —          |
| Validação             | Zod                                | 3.x                | `FR-11`    |
| Monorepo              | pnpm workspaces + Turborepo        | pnpm 9.x           | `ADR-007`  |
| Testes                | Jest · Supertest · Playwright · k6 | —                  | `DOC-052`  |
| Dados de carta        | Scryfall API                       | —                  | `DOC-035`  |

> Versões são **alvo**, não travas. O critério de atualização está em §7.

---

## 2. Frontend

### 2.1 Next.js (React) + TypeScript

**Por quê:** roteamento simples para lobbies (`/room/[id]`), SSG na landing page para SEO, e a
possibilidade de renderizar o Deckbuilder no servidor quando isso ajudar o primeiro carregamento.

**Como é usado aqui:**

| Rota                    | Estratégia de render | Motivo                                           |
| ----------------------- | -------------------- | ------------------------------------------------ |
| `/` (landing)           | SSG                  | SEO e primeiro carregamento rápido               |
| `/login`, `/dashboard`  | SSR                  | Dados por usuário                                |
| `/decks`, `/decks/[id]` | SSR + hidratação     | Conteúdo dinâmico com boa acessibilidade         |
| `/room/[id]`            | **100 % CSR**        | Canvas e WebSocket não fazem sentido no servidor |

### 2.2 Tailwind CSS

Usado para toda a UI de DOM: menus, Deckbuilder, chat, painéis. **Não** é usado dentro do Canvas
(lá não existe CSS). Os tokens de design ficam em `tailwind.config.ts` e são a fonte única de cor,
espaçamento e tipografia — ver [guia_de_ui_e_design_system.md](guia_de_ui_e_design_system.md).

### 2.3 React Konva — motor gráfico da mesa

**Por quê:** renderizar centenas de cartas com _drag-and-drop_ e zoom em `<div>` trava o navegador —
cada movimento dispara recálculo de layout na árvore do DOM. O Canvas repassa a pintura para a GPU.

**Ergonomia:** o React Konva permite declarar sprites como componentes React (`<Layer>`, `<Group>`,
`<Image>`), o que mantém o modelo mental do time consistente com o resto do frontend.

**Ressalva registrada (`ADR-003`):** acima de ~1.000 nós mutáveis, PixiJS puro rende mais. Nosso teto
é 300–400 objetos. Para manter a porta aberta, todo acesso ao motor passa por uma abstração
`CanvasRenderer` — trocar de motor não deve vazar para a lógica de jogo.

### 2.4 Zustand — estado local

**Por quê:** leve, sem _boilerplate_, sem _Provider hell_, e com seletores que evitam re-render
desnecessário — o que importa muito quando há um Canvas de 60 FPS na tela.

**Divisão de stores:**

| Store        | Conteúdo                                          | Origem da verdade                     |
| ------------ | ------------------------------------------------- | ------------------------------------- |
| `uiStore`    | zoom, câmera, modais abertos, seleção, atalhos    | **Local** — nunca vai para o servidor |
| `gameStore`  | espelho do `RoomState` alimentado pelos _patches_ | **Servidor**                          |
| `audioStore` | volume por participante, mute local, dispositivo  | **Local**                             |
| `authStore`  | usuário, tokens                                   | API Core                              |

Regra: **nada de `uiStore` trafega na rede.** O nível de zoom do jogador não é assunto de ninguém.

### 2.5 colyseus.js — cliente de tempo real

SDK oficial. Aplica os _patches_ binários no espelho local e expõe _callbacks_ de mudança
(`onAdd`, `onRemove`, `onChange`) que alimentam o `gameStore`.

### 2.6 Bibliotecas de apoio (frontend)

| Biblioteca                                     | Uso                                                 |
| ---------------------------------------------- | --------------------------------------------------- |
| `@livekit/components-react` + `livekit-client` | Voz                                                 |
| `zod`                                          | Validação de formulário compartilhada com o backend |
| `react-hook-form`                              | Formulários do Deckbuilder e login                  |
| `@tanstack/react-query`                        | Cache de dados REST (decks, busca de carta)         |
| `dompurify`                                    | Sanitização de mensagens de chat                    |
| `lucide-react`                                 | Ícones                                              |
| `sonner` (ou equivalente)                      | _Toasts_                                            |
| `next-themes`                                  | Tema claro/escuro                                   |

---

## 3. Backend

### 3.1 Node.js + TypeScript

Mantém a tipagem consistente com o frontend e permite compartilhar a definição de `Card`, `Player` e
os _payloads_ de intenção via `packages/shared-types` (`ADR-007`).

Trade-off reconhecido em `ADR-008`: Go ou Elixir seriam tecnicamente superiores para WebSocket em
massa. Node foi escolhido por **um único idioma no time** e porque o gargalo do projeto é banda e I/O,
não CPU. Ponto de reavaliação: se um nó saturar CPU com menos de 100 salas.

### 3.2 NestJS — API Core

**Por quê:** injeção de dependência, módulos, _guards_ e _pipes_ de validação prontos. Para um backend
que vai crescer em rotas (auth, decks, perfis, salas, moderação, cosméticos), a estrutura opinativa
paga o custo inicial.

**Módulos previstos:**

```
backend-core/src/
├── auth/          OAuth, JWT, refresh rotativo, guards
├── users/         perfil, preferências, exclusão de conta (LGPD)
├── decks/         CRUD, importação, validação
├── scryfall/      cliente com fila de 100 ms + card_cache
├── rooms/         criação lógica de sala, tokens de assento, lobby
├── moderation/    bloqueio e report
└── common/        filtros de exceção, interceptors, rate limit
```

### 3.3 Colyseus — servidor de jogo

**Por quê (resumo de `ADR-002`):** Socket.io só emite eventos brutos. O Colyseus mantém um `Schema` no
servidor e envia **apenas o delta binário** — se uma carta vai de `x=10` para `x=15`, o pacote são
poucos bytes, não a mesa inteira. Redução de banda acima de 90 %.

O fator decisivo, porém, é o **`@filter`**: ele implementa informação oculta _no servidor_ (`RN02`,
`FR-06`). Com Socket.io, isso seria lógica manual em cada emissão — e uma linha esquecida vaza a mão
do oponente.

**Pacotes usados:**

| Pacote                     | Função                                           |
| -------------------------- | ------------------------------------------------ |
| `colyseus`                 | Servidor e ciclo de vida de sala                 |
| `@colyseus/schema`         | Estado tipado e serialização delta               |
| `@colyseus/redis-presence` | Presença compartilhada entre nós                 |
| `@colyseus/redis-driver`   | Descoberta de sala entre nós                     |
| `@colyseus/monitor`        | Painel de inspeção de salas (protegido por auth) |
| `@colyseus/playground`     | Ferramenta de teste local                        |

### 3.4 LiveKit — voz

SFU WebRTC open-source. Em malha P2P com 4 pessoas, cada jogador faria 3 uploads da própria voz
(~90 kbps); com SFU, faz **um** (~30 kbps) — diferença decisiva em conexão doméstica com upload
assimétrico. Ver `ADR-005`.

Começa em **LiveKit Cloud** para não administrar SFU; migra para _self-hosted_ quando o custo
justificar.

### 3.5 Autenticação

| Componente             | Escolha                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Provedores             | Google e Discord via OAuth 2.0 + PKCE; e-mail/senha                                       |
| Hash de senha          | **Argon2id** (`argon2` npm)                                                               |
| Tokens                 | JWT de acesso (15 min) + _refresh_ rotativo em cookie `HttpOnly; Secure; SameSite=Strict` |
| Biblioteca no frontend | NextAuth/Auth.js **ou** cliente próprio contra o NestJS                                   |

> Decisão pendente registrada: usar Auth.js no Next (mais rápido) ou centralizar auth no NestJS
> (mais coerente com o game server, que precisa validar o mesmo JWT). **Recomendação: NestJS**, porque
> o game server precisa verificar o token e não deveria depender do runtime do Next.

### 3.6 Bibliotecas de apoio (backend)

| Biblioteca                  | Uso                                             |
| --------------------------- | ----------------------------------------------- |
| `zod`                       | Validação de todo _payload_ HTTP e WS (`FR-11`) |
| `@nestjs/throttler` + Redis | _Rate limiting_ (`NFR-04`)                      |
| `pino`                      | Log estruturado JSON                            |
| `prom-client`               | Métricas Prometheus (`NFR-11`)                  |
| `argon2`                    | Hash de senha                                   |
| `undici`                    | Cliente HTTP para a Scryfall                    |

---

## 4. Banco de dados e cache

### 4.1 PostgreSQL

Banco relacional para dados com relações estruturadas e previsíveis: usuários, decks, itens de deck,
`card_cache`. Transações ACID importam em operações como "salvar deck de 100 cartas" — que deve ser
atômica.

### 4.2 Prisma ORM

**Por quê:** migrações versionadas, cliente tipado gerado a partir do schema, e proteção nativa contra
SQL Injection por _parameterized queries_ (relevante para `DOC-051` §1.1).

**Alternativa considerada:** Drizzle — mais leve, SQL mais explícito, melhor performance em consultas
complexas. Prisma ganhou por maturidade das migrações e ergonomia de tipos. Trocar depois é viável,
já que o acesso a dados está confinado aos módulos do NestJS.

### 4.3 Redis

| Uso                                       | Criticidade                  |
| ----------------------------------------- | ---------------------------- |
| _Rate limiting_ distribuído               | Alta em produção             |
| Presence e driver do Colyseus (multi-nó)  | **Obrigatório** para escalar |
| Cache de resposta da Scryfall (TTL curto) | Média                        |
| `sessionId` de reconexão entre nós        | Alta quando há mais de um nó |
| _Snapshot_ de sala (futuro, `ADR-006`)    | —                            |

**Opcional no desenvolvimento local, obrigatório em produção multi-nó.**

---

## 5. APIs e integrações externas

| Serviço           | Uso                                  | Criticidade | Documento                                                            |
| ----------------- | ------------------------------------ | ----------- | -------------------------------------------------------------------- |
| **Scryfall API**  | Dados e imagens de carta             | Alta        | [integracoes_externas_scryfall.md](integracoes_externas_scryfall.md) |
| **Google OAuth**  | Login                                | Média       | `DOC-030`                                                            |
| **Discord OAuth** | Login (público-alvo vive no Discord) | Média       | `DOC-030`                                                            |
| **LiveKit Cloud** | Voz                                  | Média       | `DOC-034`                                                            |
| **Cloudflare**    | DNS, WAF, CDN, DDoS                  | Média       | `DOC-053`                                                            |

---

## 6. Hospedagem recomendada

| Serviço         | Recomendação                             | Motivo                                                                     | Alternativas                    |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| **Frontend**    | Vercel                                   | Integração nativa com Next.js, CDN global, previews por PR                 | Netlify, Cloudflare Pages       |
| **API Core**    | Render ou Railway                        | Deploy simples, autoscaling por CPU                                        | Fly.io, AWS ECS                 |
| **Game Server** | **VPS dedicada** (Hetzner, DigitalOcean) | Precisa de porta aberta e processo persistente. **Serverless é inviável.** | Fly.io (máquinas persistentes)  |
| **PostgreSQL**  | Neon, Supabase ou RDS                    | Backup automático e _point-in-time recovery_                               | Postgres em VPS (mais trabalho) |
| **Redis**       | Upstash ou Redis gerenciado              | Simplicidade                                                               | Redis em VPS                    |
| **Voz**         | LiveKit Cloud                            | Evita administrar SFU                                                      | LiveKit _self-hosted_           |

> **Aviso recorrente:** não hospedar o game server em plataforma serverless. WebSocket exige conexão
> persistente; _cold start_ e limite de duração de execução quebram a partida.

---

## 7. Política de versões e atualização

| Tipo de dependência                        | Política                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Núcleo** (Next, React, Colyseus, Prisma) | Atualizar _minor_ mensalmente; _major_ só com janela dedicada e teste de carga                                         |
| **Segurança**                              | Patch aplicado em até 72 h para CVE alta/crítica                                                                       |
| **Ferramental** (lint, build)              | Livre, desde que o CI passe                                                                                            |
| **Colyseus**                               | **Atenção especial:** mudanças de _major_ alteram o formato de serialização. Frontend e backend precisam subir juntos. |
| **Node.js**                                | Apenas versões LTS                                                                                                     |

**Travas:** `pnpm-lock.yaml` versionado e commitado. `engines` no `package.json` fixa a faixa de Node.
Dependabot ou Renovate abre PRs; ninguém atualiza à mão.

---

## 8. Alternativas descartadas (registro)

| Descartado                    | Em favor de | Motivo curto                                                           |
| ----------------------------- | ----------- | ---------------------------------------------------------------------- |
| Socket.io                     | Colyseus    | Sem sincronização de estado nem `@filter` (`ADR-002`)                  |
| Yjs / CRDT                    | Colyseus    | Não resolve informação oculta, que é o requisito nº 1                  |
| DOM puro para a mesa          | Canvas      | Colapso de performance (`ADR-003`)                                     |
| PixiJS no MVP                 | React Konva | Ergonomia React; PixiJS fica como plano B                              |
| Three.js                      | Canvas 2D   | Complexidade 3D sem benefício                                          |
| Go / Elixir no game server    | Node + TS   | Tipos compartilhados e um só idioma (`ADR-008`)                        |
| P2P mesh de voz               | SFU LiveKit | Upload do usuário não escala (`ADR-005`)                               |
| MongoDB                       | PostgreSQL  | Dados são relacionais e se beneficiam de ACID                          |
| Drizzle                       | Prisma      | Maturidade de migrações (reavaliável)                                  |
| Serverless para o game server | VPS         | WebSocket persistente                                                  |
| Redux                         | Zustand     | _Boilerplate_ desproporcional                                          |
| Firebase / Supabase Realtime  | Colyseus    | Sem controle de visibilidade por campo nem estado autoritativo de jogo |

---

## 9. Ferramental de desenvolvimento

| Categoria            | Ferramenta                              |
| -------------------- | --------------------------------------- |
| Monorepo             | pnpm workspaces + Turborepo             |
| Lint / formatação    | ESLint + Prettier (ou Biome)            |
| Hooks de commit      | Husky + lint-staged                     |
| Padrão de commit     | Conventional Commits                    |
| Testes unitários     | Jest (+ ts-jest)                        |
| Testes de API        | Supertest                               |
| Testes de componente | React Testing Library                   |
| Testes E2E           | Playwright                              |
| Teste de carga       | k6 (ou Artillery) para WebSocket        |
| Containers locais    | Docker Compose (Postgres + Redis)       |
| CI/CD                | GitHub Actions                          |
| Observabilidade      | Prometheus + Grafana; Sentry para erros |
| Documentação de API  | Swagger/OpenAPI gerado pelo NestJS      |
