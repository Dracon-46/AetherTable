-- Histórico de partidas: um RESUMO por partida (RN12, revista em 14/10/2026).
--
-- `match_summaries` era deliberadamente pobre — só o bastante para "partidas
-- jogadas" no perfil. O histórico pede mais: o formato e as rodadas da mesa,
-- e por participante o comandante, o deck, o bracket, a vida final e o
-- resultado. Continua sem jogadas e sem estado de jogo: não é replay.
--
-- Tudo NULL ou com padrão: as partidas gravadas antes desta migração seguem
-- válidas, só aparecem no histórico sem detalhes. `deck_id` não tem chave
-- estrangeira de propósito — o deck pode ser apagado e a partida continua
-- tendo acontecido.

-- AlterTable
ALTER TABLE "match_summaries" ADD COLUMN     "format" VARCHAR(32),
ADD COLUMN     "turns" INTEGER;

-- AlterTable
ALTER TABLE "match_participants" ADD COLUMN     "bracket" SMALLINT,
ADD COLUMN     "commander_id" VARCHAR(36),
ADD COLUMN     "deck_id" UUID,
ADD COLUMN     "deck_name" VARCHAR(80),
ADD COLUMN     "elimination_reason" VARCHAR(16),
ADD COLUMN     "final_life" INTEGER,
ADD COLUMN     "left_early" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seat" SMALLINT,
ADD COLUMN     "started_first" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "won" BOOLEAN NOT NULL DEFAULT false;

