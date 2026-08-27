-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MOD', 'ADMIN');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'DISCORD');

-- CreateEnum
CREATE TYPE "BoardType" AS ENUM ('MAIN', 'SIDEBOARD', 'COMMANDER', 'MAYBEBOARD', 'SIGNATURE_SPELL', 'CUBE', 'PLANAR', 'SCHEME', 'VANGUARD', 'ATTRACTION', 'CONTRAPTION', 'STICKER');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('DARK', 'LIGHT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VoiceMode" AS ENUM ('VAD', 'PTT');

-- CreateEnum
CREATE TYPE "CosmeticType" AS ENUM ('PLAYMAT', 'SLEEVE', 'BORDER', 'TITLE');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'CHEATING', 'SPAM', 'HATE_SPEECH', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(48),
    "password_hash" VARCHAR(255),
    "avatar_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "email_verified_at" TIMESTAMPTZ,
    "last_seen_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "provider_account_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "keybindings" JSONB NOT NULL DEFAULT '{}',
    "theme" "Theme" NOT NULL DEFAULT 'DARK',
    "active_playmat_id" UUID,
    "active_sleeve_id" UUID,
    "active_border_id" UUID,
    "active_title_id" UUID,
    "voiceMode" "VoiceMode" NOT NULL DEFAULT 'VAD',
    "ptt_key" VARCHAR(24),
    "master_volume" SMALLINT NOT NULL DEFAULT 100,
    "language" VARCHAR(8) NOT NULL DEFAULT 'pt-BR',

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "decks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "commander_id" VARCHAR(36),
    "partner_id" VARCHAR(36),
    "format_id" VARCHAR(32) NOT NULL DEFAULT 'commander',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "card_count" INTEGER NOT NULL DEFAULT 0,
    "color_identity" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deck_cards" (
    "id" UUID NOT NULL,
    "deck_id" UUID NOT NULL,
    "scryfall_id" VARCHAR(36) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_commander" BOOLEAN NOT NULL DEFAULT false,
    "board_type" "BoardType" NOT NULL DEFAULT 'MAIN',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deck_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_cache" (
    "scryfall_id" VARCHAR(36) NOT NULL,
    "oracle_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "set_code" VARCHAR(10) NOT NULL,
    "collector_num" VARCHAR(16) NOT NULL,
    "lang" VARCHAR(8) NOT NULL DEFAULT 'en',
    "cmc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "type_line" TEXT NOT NULL DEFAULT '',
    "mana_cost" VARCHAR(64) NOT NULL DEFAULT '',
    "color_identity" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "legal_commander" BOOLEAN NOT NULL DEFAULT false,
    "layout" VARCHAR(32) NOT NULL DEFAULT 'normal',
    "image_small" TEXT NOT NULL DEFAULT '',
    "image_normal" TEXT NOT NULL DEFAULT '',
    "faces" JSONB NOT NULL DEFAULT '[]',
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_cache_pkey" PRIMARY KEY ("scryfall_id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "room_code" VARCHAR(6),
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_summaries" (
    "id" UUID NOT NULL,
    "room_code" VARCHAR(6) NOT NULL,
    "player_count" SMALLINT NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "ended_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "match_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "user_id" UUID,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cosmetic_items" (
    "id" UUID NOT NULL,
    "type" "CosmeticType" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "resource_url" TEXT,
    "min_tier" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cosmetic_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cosmetic_id" UUID NOT NULL,
    "acquired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "decks_user_id_updated_at_idx" ON "decks"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "decks_is_public_idx" ON "decks"("is_public");

-- CreateIndex
CREATE INDEX "deck_cards_deck_id_idx" ON "deck_cards"("deck_id");

-- CreateIndex
CREATE INDEX "deck_cards_scryfall_id_idx" ON "deck_cards"("scryfall_id");

-- CreateIndex
CREATE UNIQUE INDEX "deck_cards_deck_id_scryfall_id_board_type_key" ON "deck_cards"("deck_id", "scryfall_id", "board_type");

-- CreateIndex
CREATE INDEX "card_cache_oracle_id_idx" ON "card_cache"("oracle_id");

-- CreateIndex
CREATE INDEX "card_cache_name_idx" ON "card_cache"("name");

-- CreateIndex
CREATE INDEX "reports_reported_id_idx" ON "reports"("reported_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "match_summaries_ended_at_idx" ON "match_summaries"("ended_at");

-- CreateIndex
CREATE INDEX "match_participants_user_id_idx" ON "match_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_match_id_user_id_key" ON "match_participants"("match_id", "user_id");

-- CreateIndex
CREATE INDEX "cosmetic_items_type_idx" ON "cosmetic_items"("type");

-- CreateIndex
CREATE INDEX "user_cosmetics_user_id_idx" ON "user_cosmetics"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_cosmetics_user_id_cosmetic_id_key" ON "user_cosmetics"("user_id", "cosmetic_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_playmat_id_fkey" FOREIGN KEY ("active_playmat_id") REFERENCES "cosmetic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_sleeve_id_fkey" FOREIGN KEY ("active_sleeve_id") REFERENCES "cosmetic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_border_id_fkey" FOREIGN KEY ("active_border_id") REFERENCES "cosmetic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_title_id_fkey" FOREIGN KEY ("active_title_id") REFERENCES "cosmetic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decks" ADD CONSTRAINT "decks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "match_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmetic_id_fkey" FOREIGN KEY ("cosmetic_id") REFERENCES "cosmetic_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
