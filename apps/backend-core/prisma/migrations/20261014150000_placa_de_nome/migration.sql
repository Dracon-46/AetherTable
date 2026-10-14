-- Placa de nome: a sexta familia de cosmeticos (DOC-060).
--
-- O fundo e a moldura do NOME do jogador na mesa — no painel de vida e no
-- rotulo da faixa. Espelha a borda de perfil, coluna por coluna:
--
--   - `NAMEPLATE` entra no enum ja junto com a familia. O `PET` nasceu fora
--     dele, e a lacuna o deixava sem registro, sem premio e sem criacao pelo
--     backoffice (ver 20260911150000_tipo_pet).
--   - `nameplate_id` e TEXTO, como `border_id`: o catalogo e fechado e
--     versionado em codigo, com ids como 'padrao' e 'ouro-real'.
--   - `active_nameplate_id` e o par Uuid com FK para `cosmetic_items`, como
--     `active_border_id` — reservado ao inventario concedido, que ninguem
--     escreve ainda.
--
-- Puramente aditiva: um valor de enum, duas colunas nulas e uma FK. Nenhum
-- DROP, nenhuma reescrita de dado; contas existentes ficam sem placa, que e o
-- padrao.

-- AlterEnum
ALTER TYPE "CosmeticType" ADD VALUE 'NAMEPLATE';

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "active_nameplate_id" UUID,
ADD COLUMN     "nameplate_id" VARCHAR(48);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_nameplate_id_fkey" FOREIGN KEY ("active_nameplate_id") REFERENCES "cosmetic_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
