-- O que ainda ficava só no navegador passa a seguir a conta.
--
-- "Notificações e a sequência de vitórias nos minigames têm que seguir a
-- conta: se eu troco de PC, zera." Quatro coisas viviam só em `localStorage`:
--
--   - `progresso_de_desafios`: uma linha por conta e desafio, com o recorde, a
--     sequência em curso e se há pergunta aberta (`em_jogo`). Tabela, e não
--     JSONB, porque muda a cada pergunta e o recorde SÓ SOBE — um
--     `UPDATE ... WHERE recorde < :novo`, atômico, que um JSONB não faz sem
--     ler e regravar o objeto inteiro. A chave primária (user_id, chave) já
--     serve à leitura por conta; não há índice à parte.
--   - `notificacoes_vistas_em` e `novidade_vista`: o "já vi" do sino. Nulas
--     significam "nunca abriu nesta conta".
--   - `preferencias_de_interface`: a aparência do site (visão do grimório,
--     densidade, idiomas…). JSONB `{}` pelo mesmo motivo de
--     `preferencias_de_mesa`, e `{}` também quer dizer "nunca configurou".
--   - `fichas_recentes`: o "Usadas recentemente" do seletor de fichas. Uma
--     LISTA, por isso o padrão é `[]`.
--
-- Puramente aditiva: quatro colunas com padrão ou nulas, uma tabela nova e
-- uma FK. Nenhum DROP, nenhuma reescrita de dado. A API antiga continua
-- funcionando sobre este banco durante a troca de versão — ela só não lê o
-- que é novo.

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "fichas_recentes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "notificacoes_vistas_em" TIMESTAMPTZ,
ADD COLUMN     "novidade_vista" VARCHAR(32),
ADD COLUMN     "preferencias_de_interface" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "progresso_de_desafios" (
    "user_id" UUID NOT NULL,
    "chave" VARCHAR(40) NOT NULL,
    "recorde" INTEGER NOT NULL DEFAULT 0,
    "sequencia" INTEGER NOT NULL DEFAULT 0,
    "em_jogo" BOOLEAN NOT NULL DEFAULT false,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "progresso_de_desafios_pkey" PRIMARY KEY ("user_id","chave")
);

-- AddForeignKey
ALTER TABLE "progresso_de_desafios" ADD CONSTRAINT "progresso_de_desafios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
