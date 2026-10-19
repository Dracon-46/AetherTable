/**
 * cabecalhos-de-seguranca.spec.ts — a CSP libera exatamente as origens que a
 * página chama, e nada quebra por uma variável de ambiente malformada.
 */

import { cabecalhosDeSeguranca, montarCsp, origemDe } from './cabecalhos-de-seguranca';

const ORIGENS = {
  api: 'https://api.aethertable.gg/api/v1',
  jogo: 'wss://jogo.aethertable.gg',
  voz: 'wss://voz.livekit.cloud',
};

/** As fontes de uma diretiva da CSP. */
function diretiva(csp: string, nome: string): string[] {
  const achada = csp.split('; ').find((d) => d.startsWith(`${nome} `));
  return achada ? achada.split(' ').slice(1) : [];
}

function cabecalho(producao: boolean, caminho: '/(.*)' | '/senha/:path*', chave: string) {
  const regra = cabecalhosDeSeguranca(ORIGENS, { producao }).find((r) => r.source === caminho);
  return regra?.headers.find((h) => h.key === chave)?.value;
}

describe('origemDe', () => {
  it('reduz a URL ao esquema, host e porta', () => {
    expect(origemDe('http://localhost:3333/api/v1')).toBe('http://localhost:3333');
    expect(origemDe('wss://jogo.aethertable.gg/sala?x=1')).toBe('wss://jogo.aethertable.gg');
  });

  it('URL inválida ou vazia vira string vazia, sem lançar', () => {
    expect(origemDe('não é url')).toBe('');
    expect(origemDe('')).toBe('');
  });
});

describe('montarCsp', () => {
  const csp = montarCsp(ORIGENS);

  it('libera a API para dados e imagens', () => {
    expect(diretiva(csp, 'connect-src')).toContain('https://api.aethertable.gg');
    expect(diretiva(csp, 'img-src')).toEqual(
      expect.arrayContaining(["'self'", 'data:', 'blob:', 'https://api.aethertable.gg']),
    );
  });

  it('libera o game server pelo WSS e pelo HTTPS do mesmo host', () => {
    expect(diretiva(csp, 'connect-src')).toEqual(
      expect.arrayContaining(['wss://jogo.aethertable.gg', 'https://jogo.aethertable.gg']),
    );
  });

  it('libera o LiveKit pelo WSS e pelo HTTPS', () => {
    expect(diretiva(csp, 'connect-src')).toEqual(
      expect.arrayContaining(['wss://voz.livekit.cloud', 'https://voz.livekit.cloud']),
    );
  });

  it('sem voz configurada, nenhum servidor de voz é liberado', () => {
    const semVoz = montarCsp({ ...ORIGENS, voz: '' });
    expect(diretiva(semVoz, 'connect-src').some((o) => o.includes('livekit'))).toBe(false);
  });

  it('uma variável malformada some da lista em vez de virar fonte inválida', () => {
    const quebrada = montarCsp({ api: 'lixo', jogo: 'também lixo', voz: '' });
    expect(diretiva(quebrada, 'connect-src')).toEqual(["'self'"]);
  });

  it('a fonte vem do próprio site e nada pode embutir a página', () => {
    expect(diretiva(csp, 'font-src')).toEqual(["'self'"]);
    expect(diretiva(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(diretiva(csp, 'object-src')).toEqual(["'none'"]);
  });
});

describe('cabecalhosDeSeguranca', () => {
  it('valem para toda página', () => {
    expect(cabecalho(true, '/(.*)', 'X-Content-Type-Options')).toBe('nosniff');
    expect(cabecalho(true, '/(.*)', 'X-Frame-Options')).toBe('DENY');
    expect(cabecalho(true, '/(.*)', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(cabecalho(true, '/(.*)', 'Permissions-Policy')).toBe(
      'camera=(), geolocation=(), microphone=(self)',
    );
  });

  it('a CSP vai em Report-Only, e só em produção', () => {
    expect(cabecalho(true, '/(.*)', 'Content-Security-Policy-Report-Only')).toBe(
      montarCsp(ORIGENS),
    );
    expect(cabecalho(true, '/(.*)', 'Content-Security-Policy')).toBeUndefined();
    expect(cabecalho(false, '/(.*)', 'Content-Security-Policy-Report-Only')).toBeUndefined();
  });

  it('a redefinição de senha não manda Referer nenhum, e vem depois da regra geral', () => {
    const regras = cabecalhosDeSeguranca(ORIGENS, { producao: true });
    expect(cabecalho(true, '/senha/:path*', 'Referrer-Policy')).toBe('no-referrer');
    expect(regras.findIndex((r) => r.source === '/senha/:path*')).toBeGreaterThan(
      regras.findIndex((r) => r.source === '/(.*)'),
    );
  });
});
