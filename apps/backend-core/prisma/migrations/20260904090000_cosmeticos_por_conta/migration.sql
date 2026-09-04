-- Cosmeticos equipados POR CONTA (DOC-060).
--
-- Eles so existiam em localStorage: trocar de navegador, limpar dados do site
-- ou entrar de outra maquina perdia a escolha inteira.
--
-- Colunas de TEXTO e nao FK: o catalogo e fechado e versionado em codigo
-- (shared-types/cosmetics.ts), com ids como 'aether-classic'. As colunas
-- active_*_id existentes sao Uuid com FK para cosmetic_items e continuam
-- reservadas ao inventario concedido — uma string do catalogo nao cabe nelas,
-- que e a razao pela qual ninguem nunca escreveu ali.
--
-- Puramente aditiva: seis ADD COLUMN, nenhum DROP, nenhuma reescrita de dado.

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "border_id" VARCHAR(48),
ADD COLUMN     "cosmeticos_de_oponentes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pet_id" VARCHAR(48),
ADD COLUMN     "playmat_id" VARCHAR(48),
ADD COLUMN     "sleeve_id" VARCHAR(48),
ADD COLUMN     "title_id" VARCHAR(48);

