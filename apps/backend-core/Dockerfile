# syntax=docker/dockerfile:1
#
# API Core (NestJS) — imagem de produção.
#
# Contexto de build: a RAIZ do monorepo (não esta pasta). É preciso ter o
# pnpm-lock.yaml e todos os manifests dos workspaces para o install resolver.
#   docker build -f apps/backend-core/Dockerfile .
#
# Por que node:22-slim e não alpine:
#   - `argon2` é módulo nativo e os prebuilds publicados são glibc; em musl
#     (alpine) o install cai para compilação e costuma quebrar.
#   - O Prisma precisa de OpenSSL, que o alpine resolve de forma diferente.
# O ganho de tamanho do alpine não paga esses dois problemas.

# ─── Estágio 1: dependências e build ────────────────────────────────────────
# A imagem base vai fixada por versão E digest. `node:22-slim` muda por baixo
# sem commit nenhum: o mesmo Dockerfile construía imagens diferentes em dias
# diferentes, e um build que passou ontem podia quebrar hoje sem diff. O
# Dependabot (ecossistema docker) abre o PR quando sai patch novo.
FROM node:22.23.3-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# Só os manifests primeiro: assim a camada de install só invalida quando uma
# dependência muda, não a cada alteração de código.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend-core/package.json  apps/backend-core/
COPY apps/game-server/package.json   apps/game-server/
COPY apps/frontend/package.json      apps/frontend/
COPY packages/shared-types/package.json    packages/shared-types/
COPY packages/scryfall-client/package.json packages/scryfall-client/

# `--ignore-scripts`: o postinstall do backend roda `prisma generate`, que
# precisa do schema — que ainda não foi copiado neste ponto.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/backend-core/ apps/backend-core/

# shared-types e scryfall-client são dependências de código, não só de tipos.
RUN pnpm --filter @aethertable/shared-types build \
  && pnpm --filter @aethertable/scryfall-client build

WORKDIR /repo/apps/backend-core
RUN pnpm exec prisma generate && pnpm exec nest build

# `pnpm deploy` monta uma árvore autocontida, com node_modules real (sem
# symlinks para fora) — é o que torna possível copiar só isso para o runtime.
#
# SEM `--legacy`: essa flag NÃO EXISTE no pnpm 9.15.4 (a versão fixada em
# `packageManager`). O comando falhava com "Unknown option: 'legacy'" e o build
# da imagem morria aqui — ou seja, nenhum dos dois serviços era publicável.
WORKDIR /repo
RUN pnpm --filter backend-core --prod deploy /out

# ─── Estágio 2: runtime ─────────────────────────────────────────────────────
FROM node:22.23.3-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/apps/backend-core/dist ./dist
# O schema e as migrations viajam junto: `prisma migrate deploy` roda a partir
# da imagem, no start.
COPY --from=builder /repo/apps/backend-core/prisma ./prisma
COPY --from=builder /repo/apps/backend-core/package.json ./package.json

# Regenera o client aqui, na estrutura FINAL de node_modules. O `prisma
# generate` que rodou como postinstall do `pnpm deploy` (estágio builder)
# escreveu dentro do virtual store temporário do pnpm — o caminho que o Node
# resolve em runtime nesta imagem é outro, e o client fica "stub"
# ("@prisma/client did not initialize yet"). Gerar de novo já em /app elimina a
# discrepância. Não precisa de DATABASE_URL: generate só lê o schema.
RUN node_modules/.bin/prisma generate

# Nunca rodar como root.
USER node

# A porta real é injetada pelo host via PORT; este EXPOSE é documentação.
EXPOSE 3333

# `nest build` emite em dist/src/main.js (o tsconfig tem rootDir "." e inclui
# src/ e prisma/), não em dist/main.js.
#
# `prisma migrate deploy` roda a cada start: é idempotente — aplica só as
# migrations pendentes — e evita depender de um passo manual de release, que o
# free tier do Render não oferece.
#
# ─── A MIGRAÇÃO VAI PELA CONEXÃO DIRETA, NÃO PELO POOLER ───────────────────
#
# Dois starts simultâneos (v0.9.0, 14/10/2026) rodaram a MESMA migração ao
# mesmo tempo: uma aplicou, a outra falhou com "enum label already exists" e
# ficou registrada como falha — e com uma falha registrada o `migrate deploy`
# recusa tudo, o container não sobe e a API inteira sai do ar.
#
# O Prisma impede isso com um advisory lock do Postgres, que é de SESSÃO. O
# `DATABASE_URL` do Neon aponta para o pooler (`-pooler` no host, PgBouncer em
# modo transação): cada comando pode cair numa conexão diferente, e o lock não
# segura nada. Só a migração usa o host direto (o mesmo sem `-pooler`); o app
# continua no pooler, que é o que aguenta as conexões do dia a dia.
CMD ["sh", "-c", "DATABASE_URL=\"$(printf '%s' \"$DATABASE_URL\" | sed 's/-pooler\\././')\" node_modules/.bin/prisma migrate deploy && exec node dist/src/main.js"]
