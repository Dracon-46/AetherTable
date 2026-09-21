/**
 * provedores.spec.ts — a diferença entre "o botão existe" e "o login funciona".
 *
 * O defeito que motivou o módulo: os dois botões de OAuth apareciam na tela de
 * login em TODO ambiente, e `render.yaml` nunca declarou `GOOGLE_CLIENT_ID` nem
 * `DISCORD_CLIENT_ID`. Em produção, clicar levava a uma página de erro do
 * próprio Google.
 */

import {
  credenciaisDoProvedor,
  provedorConfigurado,
  provedoresDisponiveis,
  urlDeCallback,
} from './provedores.js';

/** `ConfigService` de mentira: um mapa com o mesmo `get`. */
function config(valores: Record<string, string | undefined>) {
  return { get: <T = string>(chave: string) => valores[chave] as T | undefined };
}

describe('provedorConfigurado', () => {
  it('exige as DUAS credenciais', () => {
    // O erro de configuracao mais comum: copiar o id do console do provedor e
    // deixar o segredo para depois. So com o id, a estrategia subiria e
    // falharia apenas no callback — depois de o usuario ja ter autorizado o
    // acesso na tela do Google.
    const soId = config({ GOOGLE_CLIENT_ID: 'abc' });
    expect(provedorConfigurado(soId, 'google')).toBe(false);

    const soSegredo = config({ GOOGLE_CLIENT_SECRET: 'xyz' });
    expect(provedorConfigurado(soSegredo, 'google')).toBe(false);

    const completo = config({ GOOGLE_CLIENT_ID: 'abc', GOOGLE_CLIENT_SECRET: 'xyz' });
    expect(provedorConfigurado(completo, 'google')).toBe(true);
  });

  it('trata string vazia como ausente', () => {
    // `GOOGLE_CLIENT_ID=` no .env.example chega como '' e nao como undefined.
    // Sem o tratamento, o `.env.example` copiado sem preencher ligaria o botao.
    const vazio = config({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(provedorConfigurado(vazio, 'google')).toBe(false);
  });

  it('ignora espaço em volta — colar do console do provedor costuma trazer', () => {
    const comEspaco = config({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '  ' });
    expect(provedorConfigurado(comEspaco, 'google')).toBe(false);
  });

  it('um provedor ligado não liga o outro', () => {
    const so = config({ DISCORD_CLIENT_ID: 'a', DISCORD_CLIENT_SECRET: 'b' });
    expect(provedoresDisponiveis(so)).toEqual({ google: false, discord: true });
  });
});

describe('credenciaisDoProvedor', () => {
  it('devolve null em vez de credencial de mentira', () => {
    // O codigo anterior caia em 'DUMMY_GOOGLE_CLIENT_ID'. Um valor falso que
    // parece valido e o que produz um botao que leva a uma pagina de erro.
    expect(credenciaisDoProvedor(config({}), 'google')).toBeNull();
  });
});

describe('urlDeCallback', () => {
  it('deriva da URL pública da API', () => {
    const c = config({ API_PUBLIC_URL: 'https://aethertable-api.onrender.com/api/v1' });
    expect(urlDeCallback(c, 'google')).toBe(
      'https://aethertable-api.onrender.com/api/v1/auth/google/callback',
    );
  });

  it('tolera barra no fim da base', () => {
    const c = config({ API_PUBLIC_URL: 'https://api.exemplo.com/api/v1/' });
    expect(urlDeCallback(c, 'discord')).toBe(
      'https://api.exemplo.com/api/v1/auth/discord/callback',
    );
  });

  it('a variável específica tem precedência', () => {
    // Ha provedores que exigem um caminho de redirecionamento exato e
    // registrado no console deles, e nao se argumenta com isso.
    const c = config({
      API_PUBLIC_URL: 'https://api.exemplo.com/api/v1',
      GOOGLE_CALLBACK_URL: 'https://outro.exemplo.com/callback-especial',
    });
    expect(urlDeCallback(c, 'google')).toBe('https://outro.exemplo.com/callback-especial');
  });

  it('inclui o `v1` do prefixo global no padrão local', () => {
    // O padrao antigo era `/api/auth/google/callback`, uma rota que NAO existe:
    // o prefixo global da API e `api/v1` (main.ts). O provedor devolvia o
    // usuario num 404.
    expect(urlDeCallback(config({}), 'google')).toBe(
      'http://localhost:3333/api/v1/auth/google/callback',
    );
  });
});
