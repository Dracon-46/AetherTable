-- Preferencias da mesa por CONTA, e nao por navegador.
--
-- Tamanho da carta, alinhar a grade, custo de mana na mao, seguir o turno e o
-- modo do painel de vida viviam so em `localStorage`. JSONB pelo mesmo motivo
-- de `keybindings`: o conjunto muda a cada tela de configuracao nova e nunca e
-- filtrado em consulta, entao normalizar geraria uma migracao por caixinha.
--
-- `DEFAULT '{}'` e NOT NULL: quem ja tem linha em `user_preferences` passa a
-- ter o objeto vazio, que o cliente le como "nunca configurou" e por isso NAO
-- sobrescreve o que o navegador dele ja guardava.
ALTER TABLE "user_preferences"
  ADD COLUMN "preferencias_de_mesa" JSONB NOT NULL DEFAULT '{}';
