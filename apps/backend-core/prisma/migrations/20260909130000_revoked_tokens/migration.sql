-- O logout que desloga.
--
-- `POST /auth/logout` era `return;` — corpo vazio, nao revogava nada — e o
-- frontend nem o chamava: handleLogout so limpava o localStorage. Com o access
-- token valendo 24h e sem denylist, SAIR DA CONTA DEIXAVA UM TOKEN VALIDO POR
-- ATE UM DIA.
--
-- Uma linha por logout, apagada quando o token expira.
--
-- Tabela e nao Redis porque o Redis e OPCIONAL neste projeto (USE_REDIS, e so
-- no game-server): uma trava de seguranca que so funciona quando um servico
-- opcional esta de pe nao e uma trava.

-- CreateTable
CREATE TABLE "revoked_tokens" (
    "jti" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "revoked_tokens_expires_at_idx" ON "revoked_tokens"("expires_at");
