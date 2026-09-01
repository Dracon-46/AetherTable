# syntax=docker/dockerfile:1
#
# Game server (Colyseus) — imagem de produção.
#
# Contexto de build: a RAIZ do monorepo.
#   docker build -f apps/game-server/Dockerfile .
#
# AVISO ARQUITETURAL (docs/stack_tecnologico.md §6): este processo NÃO roda em
# plataforma serverless. O WebSocket exige conexão persistente; cold start e
# limite de duração de execução quebram a partida no meio. Precisa ser um
# container de longa duração (Render Web Service, Fly Machine, Koyeb, VPS).

# ─── Estágio 1: dependências e build ────────────────────────────────────────
FROM node:22-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# GIT É DEPENDÊNCIA DE BUILD, e a `node:22-slim` não o traz.
#
# `@colyseus/uwebsockets-transport` depende de `uWebSockets.js`, que NÃO está
# publicado no npm: é instalado a partir do repositório do GitHub. O `pnpm
# deploy` re-resolve as dependências e precisa do git para buscá-la.
#
# O sintoma não aponta para o git em lugar nenhum:
#
#   ENOENT  Command failed with ENOENT: git ls-remote --refs ...
#   spawn git ENOENT
#
# `spawn git ENOENT` quer dizer "o binário git não existe", não "o repositório
# não existe" — mas a linha de cima mostra uma URL do GitHub, o que leva a
# investigar rede, credencial e permissão do repositório antes de desconfiar da
# imagem base.
#
# Repare que o `pnpm install` ANTERIOR passa sem git: o lockfile já traz a
# referência resolvida. Só o `deploy` quebra. Por isso o erro aparece no fim de
# um build que parecia estar indo bem.
#
# Fica só no estágio de build; a imagem final não leva git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend-core/package.json  apps/backend-core/
COPY apps/game-server/package.json   apps/game-server/
COPY apps/frontend/package.json      apps/frontend/
COPY packages/shared-types/package.json    packages/shared-types/
COPY packages/scryfall-client/package.json packages/scryfall-client/
COPY packages/ui/package.json              packages/ui/

# `--ignore-scripts` evita o postinstall do backend-core (prisma generate), que
# é irrelevante aqui e exigiria copiar o schema.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/game-server/ apps/game-server/

RUN pnpm --filter @aethertable/shared-types build \
  && pnpm --filter game-server build

# Sem `--legacy`: a flag não existe no pnpm 9.15.4 e derrubava o build.
RUN pnpm --filter game-server --prod deploy /out

# ─── Estágio 2: runtime ─────────────────────────────────────────────────────
FROM node:22-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/apps/game-server/dist ./dist
COPY --from=builder /repo/apps/game-server/package.json ./package.json

USER node

# A porta real vem do host via PORT; este EXPOSE é documentação.
EXPOSE 2567

CMD ["node", "dist/index.js"]
