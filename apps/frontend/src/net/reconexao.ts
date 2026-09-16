'use client';

/**
 * reconexao.ts — a chave que faz o F5 voltar para a mesa.
 *
 * ─── O BURACO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * O servidor SEMPRE guardou o assento de quem cai: `onLeave` com
 * `consented === false` chama `allowReconnection` e segura a vaga, as cartas e
 * a mão por 90 segundos. Esse mecanismo existia, estava correto, e nunca era
 * exercitado — porque o cliente não tinha como voltar.
 *
 * O `seatToken` que abre a sala é de USO ÚNICO (`jtisUsados`, FR-20): depois da
 * primeira entrada o servidor o recusa com `TOKEN_ALREADY_USED`, para sempre. E
 * ele vive na query string da URL, que o F5 preserva — então recarregar
 * reenviava exatamente o token queimado. O jogador via "conexão recusada" numa
 * sala cujo assento ainda estava reservado para ele, esperando por 90 segundos
 * que ninguém usava.
 *
 * O `reconnectionToken` do Colyseus é outra coisa: emitido por CONEXÃO, não por
 * assento, e válido enquanto a janela de reconexão estiver aberta. É a chave
 * certa para esta fechadura.
 *
 * ─── POR QUE `sessionStorage` E NÃO `localStorage` ─────────────────────────
 *
 * A chave vale para ESTA aba e para esta sessão de navegação. Em
 * `localStorage`, abrir a mesa numa segunda aba encontraria a chave da primeira
 * e tentaria roubar a conexão dela — duas abas disputando o mesmo assento, cada
 * uma derrubando a outra. `sessionStorage` é por aba e sobrevive ao F5, que é
 * exatamente o recorte que precisamos.
 *
 * ─── A CHAVE É POR SALA ────────────────────────────────────────────────────
 *
 * Sair de uma mesa e entrar em outra na mesma aba não pode reaproveitar a chave
 * da anterior: o `reconnect` iria para a sala errada e falharia de um jeito que
 * parece "a mesa nova está quebrada".
 */

const PREFIXO = 'aethertable:reconexao:';

const chave = (roomId: string) => `${PREFIXO}${roomId}`;

/**
 * Toda função aqui engole a exceção.
 *
 * `sessionStorage` lança em modo privado de alguns navegadores e quando o site
 * está com armazenamento bloqueado. Nenhum desses casos pode impedir de entrar
 * na mesa — perder a reconexão é degradar para o comportamento antigo, que era
 * jogável; lançar aqui seria uma tela de erro na entrada.
 */
export function guardarReconexao(roomId: string, token: string | undefined): void {
  if (!token) return;
  try {
    window.sessionStorage.setItem(chave(roomId), token);
  } catch {
    /* sem armazenamento: segue sem rede de segurança */
  }
}

export function lerReconexao(roomId: string): string | null {
  try {
    return window.sessionStorage.getItem(chave(roomId));
  } catch {
    return null;
  }
}

/**
 * Apaga a chave.
 *
 * Chamada em dois momentos, por razões diferentes:
 *
 *   - quando o jogador SAI de propósito, para o próximo F5 na mesma aba não
 *     tentar voltar para uma mesa que ele deixou;
 *   - quando um `reconnect` falha, porque uma chave que não funciona mais só
 *     serve para atrasar a próxima tentativa com um round-trip inútil.
 */
export function esquecerReconexao(roomId: string): void {
  try {
    window.sessionStorage.removeItem(chave(roomId));
  } catch {
    /* idem */
  }
}
