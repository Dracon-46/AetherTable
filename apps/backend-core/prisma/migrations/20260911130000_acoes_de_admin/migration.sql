-- Duas acoes novas do backoffice na trilha de auditoria.
--
-- USER_PASSWORD_RESET: o admin redefine a senha de uma conta. A senha e gerada
-- pelo servidor, mostrada uma vez e nunca registrada — o log guarda QUEM fez,
-- em QUEM e POR QUE, que e o que uma auditoria precisa responder.
--
-- USER_PURGE: expurgo definitivo. Diferente de USER_BAN, que e soft delete e
-- tem volta por USER_RESTORE, este apaga a linha e o que depende dela.
ALTER TYPE "AdminAction" ADD VALUE 'USER_PASSWORD_RESET';
ALTER TYPE "AdminAction" ADD VALUE 'USER_PURGE';
