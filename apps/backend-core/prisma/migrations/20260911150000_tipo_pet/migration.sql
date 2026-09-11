-- Mascote entra no enum de cosmeticos.
--
-- `PET` faltava desde a primeira migracao, e a ausencia tinha consequencia: o
-- catalogo em codigo lista mascotes, mas `cosmetic_items` nao tinha tipo para
-- eles -- o painel os mostrava com `tipo: null` e eles eram os unicos
-- cosmeticos que nao podiam ser registrados, concedidos como premio, nem ter
-- tier controlado pelo backoffice.
ALTER TYPE "CosmeticType" ADD VALUE 'PET';
