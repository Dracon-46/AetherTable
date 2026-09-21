'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Flame, LogIn, Swords, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { CenaDoDragao, useDragao } from './CenaDoDragao';
import { useAuthStore } from '../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { api } from '@/lib/fetcher';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';

/**
 * ─── AS FRASES DE ERRO DE OAUTH MORAM AQUI, NÃO NA URL ─────────────────────
 *
 * O backend redireciona para `/?erro=<codigo>` com um código de um conjunto
 * fechado. Ele não manda a mensagem pronta de propósito: desenhar na tela um
 * texto vindo da querystring é a forma mais simples de transformar a própria
 * página de login numa página de phishing hospedada no domínio certo ("Sua
 * conta foi bloqueada, ligue para 0800…"). Com o dicionário aqui, a tela só
 * sabe escrever o que ela mesma tem.
 *
 * Ver `auth/erro-de-oauth.ts` no backend.
 */
const MENSAGEM_DE_OAUTH: Record<string, string> = {
  indisponivel: 'Este provedor não está disponível neste servidor. Entre com e-mail e senha.',
  sem_email:
    'O provedor não informou um e-mail utilizável. Verifique a privacidade do e-mail na conta dele e tente de novo.',
  email_nao_verificado:
    'O provedor não confirmou que este e-mail é seu. Confirme o endereço na conta do provedor e tente de novo.',
  email_em_uso: 'Este e-mail já pertence a uma conta do AetherTable. Entre com e-mail e senha.',
  recusado: 'Você cancelou a autorização no provedor.',
  falhou: 'Não foi possível concluir o login pelo provedor. Tente de novo.',
};

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  // A cena do dragão (fundo, véu, brasas e sopro) vive em CenaDoDragao.
  const { fase, carregar, relaxar, cuspir } = useDragao();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Estado do cold start. O módulo `net/wake.ts` existia desde sempre, com
   * documentação e tudo — e NENHUM arquivo o importava. No plano gratuito o
   * serviço hiberna após ~15 min e a primeira requisição fica pendurada ~50 s:
   * sem este aviso, o usuário clica, nada acontece, e ele clica de novo.
   */
  const [estadoServidor, setEstadoServidor] = useState<EstadoAcordar | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /**
   * Quais botões de OAuth desenhar.
   *
   * ─── O BOTÃO ERA DESENHADO SEMPRE, E EM PRODUÇÃO NÃO LEVAVA A LUGAR NENHUM ─
   *
   * `render.yaml` nunca declarou `GOOGLE_CLIENT_ID` nem `DISCORD_CLIENT_ID`: o
   * backend subia com credenciais de exemplo e o clique terminava numa página
   * de erro do próprio Google ("The OAuth client was not found"). O aviso de
   * "DUMMY KEYS" que existia aqui era condicionado a `NODE_ENV` — ou seja,
   * sumia exatamente no ambiente onde o problema estava.
   *
   * Agora o servidor responde quais provedores ele tem de verdade, e um botão
   * na tela é a promessa de que aquele caminho funciona.
   *
   * `retry: false` e `staleTime: Infinity`: é configuração de servidor, não
   * muda enquanto a aba estiver aberta, e insistir numa API hibernando só
   * atrasaria o formulário de senha, que não depende dela.
   */
  const { data: provedores } = useQuery({
    queryKey: ['auth', 'provedores'],
    queryFn: () => api<Record<string, boolean>>('/auth/provedores', { publica: true }),
    staleTime: Infinity,
    retry: false,
  });

  /**
   * O código de erro que o callback de OAuth deixou na URL.
   *
   * Lido de `window.location` e não de `useSearchParams()` pelo motivo
   * documentado em `OAuthTokenCapture`: o hook obriga a rota a renderizar no
   * cliente e já quebrou o `next build` deste projeto com "useSearchParams()
   * should be wrapped in a suspense boundary". Esta é a `/` — a rota que menos
   * pode sair da pré-renderização.
   */
  const [erroDeOAuth, setErroDeOAuth] = useState<string | null>(null);

  useEffect(() => {
    const codigo = new URLSearchParams(window.location.search).get('erro');
    if (!codigo) return;

    setErroDeOAuth(MENSAGEM_DE_OAUTH[codigo] ?? MENSAGEM_DE_OAUTH.falhou!);
    // Tira o `?erro=` da barra de endereço: recarregar a página não deve
    // ressuscitar um erro que a pessoa já leu.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    // Tentar entrar por senha descarta o aviso do provedor: ele já foi lido, e
    // deixá-lo na tela ao lado de um erro novo confundiria os dois.
    setErroDeOAuth(null);
    // Entrar É o sopro. No plano gratuito o login pode levar ~50 s acordando o
    // container; a criatura cuspindo é o que preenche essa espera.
    cuspir();

    try {
      // Acorda o serviço ANTES do POST: um login enviado contra um container
      // hibernando fica pendurado sem feedback nenhum.
      const acordou = await acordarApi(setEstadoServidor);
      if (!acordou) {
        setError(MENSAGEM_POR_ESTADO.falhou);
        setIsLoggingIn(false);
        setEstadoServidor(null);
        return;
      }

      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Credenciais inválidas');
      }

      // Sucesso! A API retorna accessToken (camelCase)
      setAuth(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setIsLoggingIn(false);
    } finally {
      setEstadoServidor(null);
    }
  };

  /*
   * `min-h-dvh`, não `min-h-screen`: `100vh` no celular é a altura da janela SEM
   * a barra do navegador, então a tela "cabe" no CSS e sobra conteúdo embaixo da
   * barra na vida real — o clássico "tem que rolar para ver o botão". `dvh`
   * acompanha a barra que aparece e some.
   *
   * `py-4` para o painel nunca encostar na borda, e `overflow-y-auto` como
   * válvula: numa janela realmente minúscula é melhor rolar dentro da tela do
   * que ter o botão de entrar recortado e inalcançável.
   */
  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-y-auto overflow-x-hidden px-3 py-4">
      <CenaDoDragao fase={fase} carregar={carregar} relaxar={relaxar} cuspir={cuspir} />

      {/* Painel de Login Glassmorphism */}
      <div
        className={`bg-panel/80 border-panel-border relative z-10 my-auto w-full max-w-md rounded-lg border p-5 shadow-2xl backdrop-blur-md transition-transform duration-300 sm:p-7 ${error || erroDeOAuth ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}
      >
        {/* O cabeçalho encolhe em telas baixas: numa janela de 700px a
            saudação custava ~180px que o formulário precisava mais. */}
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="bg-table-deep border-panel-border mb-3 rounded-full border p-2.5 shadow-inner">
            <Swords className="text-primary h-7 w-7" />
          </div>
          <h1 className="text-text text-xl font-bold sm:text-2xl">AetherTable</h1>
          <p className="text-text-muted mt-1 text-sm">
            Prepare suas defesas, o embate vai começar.
          </p>
        </div>

        {estadoServidor === 'acordando' && (
          <div className="border-warning/40 bg-warning/10 mb-4 flex items-start gap-3 rounded border p-3">
            <AlertCircle className="text-warning mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-warning text-sm">{MENSAGEM_POR_ESTADO.acordando}</p>
          </div>
        )}

        {erroDeOAuth && (
          <div className="bg-danger/20 border-danger/50 mb-4 flex items-start gap-3 rounded border p-3">
            <AlertCircle className="text-danger mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-danger text-sm">{erroDeOAuth}</p>
          </div>
        )}

        {error && (
          <div className="bg-danger/20 border-danger/50 mb-4 flex items-start gap-3 rounded border p-3">
            <AlertCircle className="text-danger mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              E-mail
            </label>
            <input
              type="email"
              required
              disabled={isLoggingIn}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-table-deep border-panel-border text-text focus:border-primary focus:ring-primary w-full rounded-md border px-4 py-2.5 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                Senha
              </label>
              {/* Era `<a href="#">` — DOC-094 §I.8, "não há recuperação de
                  senha". Agora leva a /senha/esqueci. */}
              <Link
                href="/senha/esqueci"
                className="text-primary hover:text-primary-hover text-xs transition-colors"
              >
                Esqueceu?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isLoggingIn}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-table-deep border-panel-border text-text focus:border-primary focus:ring-primary w-full rounded-md border px-4 py-2.5 pr-12 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
                placeholder="••••••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-text-muted hover:text-primary absolute right-3 top-1/2 -translate-y-1/2 transition-colors focus:outline-none"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            // O botão também carrega o dragão: mirar em "Entrar" é mirar no
            // bote. O sopro em si sai no `handleSubmit`, junto do login.
            onMouseEnter={carregar}
            onMouseLeave={relaxar}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
              isLoggingIn
                ? 'bg-danger cursor-wait text-white'
                : 'bg-primary hover:bg-primary-hover text-white active:scale-95'
            } `}
          >
            {isLoggingIn ? (
              <>
                <Flame className="h-4 w-4 animate-bounce" />
                {estadoServidor === 'acordando' ? 'Acordando o servidor…' : 'Invocando...'}
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" />
                Entrar no Saguão
              </>
            )}
          </button>
        </form>

        {/* ─── SÓ APARECE O QUE FUNCIONA ────────────────────────────────────
            O bloco inteiro era renderizado sempre, com os dois botões e um
            aviso de "DUMMY KEYS" condicionado a `NODE_ENV`. Em produção o
            aviso sumia e os botões ficavam — levando a uma página de erro do
            próprio provedor, porque `render.yaml` nunca declarou as chaves.

            Agora o servidor diz o que tem (`GET /auth/provedores`), e um botão
            aqui é a promessa de que aquele caminho funciona. Sem provedor
            nenhum, some também o separador: um "ou continue com" seguido de
            nada é pior que nada. */}
        {(provedores?.google || provedores?.discord) && (
          <>
            <div className="mt-4 flex items-center justify-between">
              <span className="border-panel-border w-1/5 border-b lg:w-1/4"></span>
              <span className="text-text-muted text-center text-xs uppercase">ou continue com</span>
              <span className="border-panel-border w-1/5 border-b lg:w-1/4"></span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {provedores.google && (
                <button
                  onClick={() => (window.location.href = `${API_URL}/auth/google`)}
                  className="border-panel-border text-text hover:bg-panel-hover flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
                >
                  <img
                    src="https://www.svgrepo.com/show/475656/google-color.svg"
                    alt=""
                    className="h-5 w-5"
                  />
                  Google
                </button>
              )}

              {provedores.discord && (
                <button
                  onClick={() => (window.location.href = `${API_URL}/auth/discord`)}
                  className="border-panel-border text-text hover:bg-panel-hover flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
                >
                  <img
                    src="https://www.svgrepo.com/show/353655/discord-icon.svg"
                    alt=""
                    className="h-5 w-5"
                  />
                  Discord
                </button>
              )}
            </div>
          </>
        )}

        <div className="border-panel-border mt-5 border-t pt-4 text-center">
          <p className="text-text-muted text-sm">
            Não tem uma conta?{' '}
            <Link
              href="/register"
              className="text-primary hover:text-primary-hover font-medium transition-colors"
            >
              Aliste-se
            </Link>
          </p>

          {/* A política precisa ser alcançável DA PÁGINA INICIAL, e não só pela
              URL direta: é o que o console do Google confere ao publicar o app
              OAuth, e é onde uma pessoa procura antes de entregar o e-mail. */}
          <p className="text-text-muted/70 mt-3 text-xs">
            <Link href="/privacidade" className="hover:text-primary transition-colors">
              Política de Privacidade
            </Link>
            <span className="mx-1.5">·</span>
            <span>Projeto de fã, sem vínculo com a Wizards of the Coast</span>
          </p>
        </div>
      </div>
    </div>
  );
}
