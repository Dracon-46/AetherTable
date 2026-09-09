-- Direito a cosmetico de apoiador, por conta.
--
-- O catalogo (shared-types/cosmetics.ts, DOC-060) marca itens como FREE ou
-- APOIADOR, e a interface desenhava um cadeado nos de apoiador. O CADEADO ERA
-- DECORATIVO: o botao nao tinha `disabled`, o DTO validava so a existencia do
-- id no catalogo, e updateUser gravava direto. Qualquer conta equipava
-- qualquer coisa, e nao havia nada no banco contra o que checar.
--
-- Nao existe pagamento neste repositorio. O tier e ADMINISTRADO PELO
-- BACKOFFICE, que ja tem tela de usuarios e trilha de auditoria; quando houver
-- integracao de pagamento, ela escreve nesta mesma coluna.
--
-- Aditiva e com default: nenhuma conta existente muda de comportamento, e
-- todas passam a ter um valor contra o qual a checagem pode rodar.

-- CreateEnum
CREATE TYPE "SupporterTier" AS ENUM ('FREE', 'APOIADOR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "supporter_tier" "SupporterTier" NOT NULL DEFAULT 'FREE';
