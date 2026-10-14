-- Comentários em decks públicos e pastas na lista de decks.
--
-- `deck_comments`: um comentário por linha, 500 caracteres no máximo, e CASCADE
-- dos dois lados — some com o deck e com a conta de quem escreveu. O índice
-- (deck_id, created_at DESC) é o da leitura: os 100 mais recentes de um deck.
--
-- `decks.folder`: texto livre e nulo. Pasta não é tabela; ver o comentário
-- do campo no schema.
--
-- Puramente aditiva: uma coluna nula e uma tabela nova.

-- AlterTable
ALTER TABLE "decks" ADD COLUMN     "folder" VARCHAR(40);

-- CreateTable
CREATE TABLE "deck_comments" (
    "id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deck_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deck_comments_deck_id_created_at_idx" ON "deck_comments"("deck_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deck_comments_user_id_idx" ON "deck_comments"("user_id");

-- AddForeignKey
ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_comments" ADD CONSTRAINT "deck_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

