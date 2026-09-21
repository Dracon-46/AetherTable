-- "Esqueceu?" passa a levar a algum lugar.
--
-- A tela de login tinha `<a href="#">Esqueceu?</a>` — registrado na auditoria
-- de paridade (DOC-094 §I.8) como "nao ha recuperacao de senha". Quem esquecia
-- a senha perdia a conta, ou pedia a um administrador, que gerava uma senha
-- temporaria no backoffice e a entregava por fora — colocando uma credencial
-- em transito por WhatsApp ou Discord.
--
-- A COLUNA GUARDA A HASH DO TOKEN, NAO O TOKEN. Em claro, um dump deste banco
-- entregaria uma lista de links de redefinicao VIVOS. Com SHA-256, entrega uma
-- coluna inutil: redefinir exige o texto que so existe na caixa de entrada.
--
-- Sem sal e sem Argon2 de proposito: o segredo tem 256 bits de CSPRNG e vive 30
-- minutos, entao nao ha dicionario contra o qual proteger — so haveria custo de
-- CPU numa consulta por chave primaria.
--
-- ON DELETE CASCADE, ao contrario de `revoked_tokens`: um token revogado e o
-- registro de algo que aconteceu e pode sobreviver a conta; isto e uma CHAVE DE
-- ENTRADA, e nao pode.

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
