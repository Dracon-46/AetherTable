-- Backoffice (DOC-061): auditoria, suspensao temporaria, evidencia de denuncia
-- e interruptores de plataforma.
--
-- GERADA POR `prisma migrate diff` E NAO APLICADA. Rode `pnpm db:migrate`
-- (ou `prisma migrate deploy`) quando quiser aplicar — o banco e o Neon
-- compartilhado, e aplicar DDL nele nao e decisao de quem escreve a migracao.
--
-- Nao ha CREATE UNIQUE INDEX aqui: a deduplicacao de denuncias vive na
-- aplicacao, e o motivo esta no comentario do model `Report` no schema
-- (resumo: `room_code` e anulavel, e no Postgres NULLs nao colidem num indice
-- unico). Esta migracao so ADICIONA colunas, tabelas e indices de busca — nao
-- reescreve nem apaga linha nenhuma.

-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('USER_SUSPEND', 'USER_UNSUSPEND', 'USER_BAN', 'USER_RESTORE', 'USER_ROLE_CHANGE', 'INVENTORY_GRANT', 'INVENTORY_REVOKE', 'COSMETIC_CREATE', 'COSMETIC_UPDATE', 'COSMETIC_DELETE', 'REPORT_CLAIM', 'REPORT_RESOLVE', 'REPORT_DISMISS', 'FLAG_CHANGE', 'CARD_CACHE_PURGE');

-- DropIndex
DROP INDEX "reports_status_idx";

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMPTZ,
ADD COLUMN     "resolved_by_id" UUID,
ADD COLUMN     "snapshot" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "suspended_until" TIMESTAMPTZ,
ADD COLUMN     "suspension_reason" TEXT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_label" VARCHAR(64) NOT NULL,
    "action" "AdminAction" NOT NULL,
    "target_type" VARCHAR(24) NOT NULL,
    "target_id" VARCHAR(64),
    "target_label" VARCHAR(160),
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_flags" (
    "key" VARCHAR(48) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by_id" UUID,
    "updated_by" VARCHAR(64),

    CONSTRAINT "platform_flags_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_reporter_id_reported_id_reason_idx" ON "reports"("reporter_id", "reported_id", "reason");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_suspended_until_idx" ON "users"("suspended_until");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

