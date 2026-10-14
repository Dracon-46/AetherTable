-- O Explorar: decks públicos e curtidas (DOC-094 II.8).
--
-- `decks.is_public` existe desde o início, com índice, e nenhuma rota o lia:
-- marcar um deck como público não mudava nada para ninguém. Esta migração dá
-- ao campo o que ele precisava para valer algo — um lugar onde os públicos
-- aparecem e um jeito de dizer "gostei deste".
--
-- `like_count` é DESNORMALIZADO pelo mesmo motivo do `card_count`: ordenar
-- por "mais curtidos" contando `deck_likes` a cada página seria um GROUP BY
-- por visita. O serviço o mantém na mesma transação da curtida.
--
-- A chave primária composta (deck_id, user_id) é a regra "uma curtida por
-- conta" — no banco, e não num "já curtiu?" no código, que perderia para duas
-- requisições simultâneas.

-- AlterTable
ALTER TABLE "decks" ADD COLUMN     "like_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "deck_likes" (
    "deck_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deck_likes_pkey" PRIMARY KEY ("deck_id","user_id")
);

-- CreateIndex
CREATE INDEX "deck_likes_user_id_idx" ON "deck_likes"("user_id");

-- CreateIndex
CREATE INDEX "decks_is_public_like_count_idx" ON "decks"("is_public", "like_count" DESC);

-- AddForeignKey
ALTER TABLE "deck_likes" ADD CONSTRAINT "deck_likes_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_likes" ADD CONSTRAINT "deck_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

