/**
 * leitura-do-sino.ts — o "já vi" do sino de notificações, na conta.
 *
 * O sino guardava no `localStorage` a data da última vez que foi aberto e a
 * última versão de Novidades lida. Em outra máquina, tudo voltava a acender
 * como novo. Agora as duas coisas moram em `user_preferences`
 * (`notificacoes_vistas_em` e `novidade_vista`), e o navegador continua
 * guardando a sua cópia como cache.
 */

/** `GET /notificacoes/leitura` e a resposta do `PUT`. */
export interface LeituraDoSino {
  /** ISO 8601. `null`: o sino nunca foi aberto nesta conta. */
  vistoEm: string | null;
  /** A versão de Novidades lida por último (`'0.9.6'`). */
  novidadeVista: string | null;
}

/** O tamanho da coluna `novidade_vista`. Uma versão cabe com folga. */
export const MAX_VERSAO_DE_NOVIDADE = 32;

/**
 * Quanto o `vistoEm` pode estar à frente do relógio do servidor.
 *
 * O cliente marca "visto" com a hora DELE (ou a do aviso mais novo, se for
 * maior), e relógio de aparelho erra por segundos ou minutos. Cinco minutos
 * cobrem esse erro; uma data de amanhã seria um jeito de nunca mais ver aviso
 * nenhum — tudo o que chegasse até lá já nasceria "visto".
 */
export const TOLERANCIA_DO_RELOGIO_MS = 5 * 60 * 1000;
