-- Cosmeticos compostos no backoffice.
--
-- `parametros` guarda a descricao procedural (cores, padrao, forma) de um item
-- que NAO existe no catalogo em codigo. Nulo = o item veio do bundle.
--
-- Nao ha DEFAULT e a coluna e nula de proposito: toda linha que ja existe
-- refere-se a um item do bundle, e e exatamente isso que NULL significa aqui.
ALTER TABLE "cosmetic_items" ADD COLUMN "parametros" JSONB;

-- Um catalogoId por tipo. Ja era a intencao de `criarCosmetico` (ele consulta
-- antes de inserir), mas consulta-antes-de-inserir e uma trava com janela: duas
-- requisicoes simultaneas passam as duas. Com item AUTORAL isso passaria a
-- importar de verdade, porque o id duplicado viraria dois desenhos diferentes
-- para a mesma chave, e qual deles o jogador ve dependeria da ordem do banco.
CREATE UNIQUE INDEX "cosmetic_items_type_resource_url_key"
  ON "cosmetic_items" ("type", "resource_url");
