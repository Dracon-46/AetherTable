'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import {
  AVISO_ALERTA,
  AVISO_ERRO,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
  CAMPO,
  CabecalhoDoCartao,
  LINK,
  PortaFalkyria,
  ROTULO,
} from './PortaFalkyria';
import type { HumorDoDragao } from '../components/DragaoAether';
import { useAuthStore, type SessaoDaApi } from '../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { api, mensagemDoCorpoDeErro } from '@/lib/fetcher';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';
import { OAuthTokenCapture } from '../components/OAuthTokenCapture';
import { AssinaturaFalkyria } from '../components/AssinaturaFalkyria';
import { iniciarOAuth } from '../lib/oauth';
import { IDIOMAS_DA_INTERFACE, useLangDoDocumento, useT } from '../i18n/i18n';
import { useAparencia } from '../store/aparencia.store';

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
  /** Qual campo tem o foco: é o que o dragão olha (ver `humor`). */
  const [campoEmFoco, setCampoEmFoco] = useState<'email' | 'senha' | null>(null);

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
  const t = useT();
  useLangDoDocumento();
  const idioma = useAparencia((s) => s.idiomaDaInterface);
  const setIdioma = useAparencia((s) => s.setIdiomaDaInterface);

  useEffect(() => {
    const codigo = new URLSearchParams(window.location.search).get('erro');
    if (!codigo) return;

    // `hasOwn`, e não `dicionario[codigo]`: `?erro=__proto__` (ou `constructor`)
    // devolvia um objeto herdado, e desenhá-lo derrubava a página de login.
    setErroDeOAuth(
      Object.hasOwn(MENSAGEM_DE_OAUTH, codigo)
        ? MENSAGEM_DE_OAUTH[codigo]!
        : MENSAGEM_DE_OAUTH.falhou!,
    );
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

      const data = (await response.json()) as SessaoDaApi;

      if (!response.ok) {
        // Um 400 de validação (e-mail malformado) dizia só "Dados inválidos.";
        // o campo e o motivo vêm em `erros[]`. Ver `mensagemDoCorpoDeErro`.
        throw new Error(mensagemDoCorpoDeErro(data) ?? 'Credenciais inválidas');
      }

      // Sucesso! A API retorna accessToken (camelCase)
      setAuth(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
      setIsLoggingIn(false);
    } finally {
      setEstadoServidor(null);
    }
  };

  /*
   * O dragão reage ao formulário, como o Nicx no painel: fecha os olhos quando
   * a senha escondida está sendo digitada, acende enquanto o login sai (no plano
   * gratuito a espera pode chegar a ~50 s acordando o container) e recusa
   * quando dá erro. A ordem importa: o envio em curso vence o erro antigo.
   */
  const humor: HumorDoDragao = isLoggingIn
    ? 'invocando'
    : error || erroDeOAuth
      ? 'alerta'
      : campoEmFoco === 'senha' && !showPassword
        ? 'olhos-fechados'
        : campoEmFoco
          ? 'atento'
          : 'repouso';

  return (
    <PortaFalkyria
      chamada={t('Prepare suas defesas, o embate vai começar.')}
      humor={humor}
      tremer={!!(error || erroDeOAuth)}
    >
      {/* Quem volta do OAuth SEM sessão é desviado para cá pelo
          `ProtectedRoute`, com o `#token=` preservado. A captura só existia no
          layout do painel — atrás do mesmo porteiro que barrava a entrada —, e
          o token morria no desvio. */}
      <OAuthTokenCapture />

      <CabecalhoDoCartao
        icone={<LogIn size={17} aria-hidden="true" />}
        titulo={t('Entrar')}
        subtitulo={t('Prepare suas defesas, o embate vai começar.')}
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-5">
        {estadoServidor === 'acordando' && (
          <div className={AVISO_ALERTA}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{t(MENSAGEM_POR_ESTADO.acordando)}</p>
          </div>
        )}

        {erroDeOAuth && (
          <div role="alert" className={AVISO_ERRO}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{t(erroDeOAuth)}</p>
          </div>
        )}

        {error && (
          <div role="alert" className={AVISO_ERRO}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{t(error)}</p>
          </div>
        )}
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="entrada-email" className={ROTULO}>
            {t('E-mail')}
          </label>
          <input
            id="entrada-email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            disabled={isLoggingIn}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => setCampoEmFoco('email')}
            onBlur={() => setCampoEmFoco(null)}
            className={CAMPO}
            placeholder={t('seuemail@exemplo.com')}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="entrada-senha" className={ROTULO}>
              {t('Senha')}
            </label>
            {/* Era `<a href="#">` — DOC-094 §I.8, "não há recuperação de
                senha". Agora leva a /senha/esqueci. */}
            <Link href="/senha/esqueci" className={`${LINK} text-xs`}>
              {t('Esqueceu?')}
            </Link>
          </div>
          <div className="relative">
            <input
              id="entrada-senha"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              disabled={isLoggingIn}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setCampoEmFoco('senha')}
              onBlur={() => setCampoEmFoco(null)}
              className={`${CAMPO} pr-12`}
              placeholder="••••••••••••"
            />
            {/* O primeiro `type="button"` da página: o e2e de telas públicas
                clica nele para conferir que o tipo do campo alterna. */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t('Esconder a senha') : t('Mostrar a senha')}
              aria-pressed={showPassword}
              className="text-subtle hover:text-ink absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button type="submit" disabled={isLoggingIn} className={`${BOTAO_PRIMARIO} mt-1`}>
          {isLoggingIn ? (
            estadoServidor === 'acordando' ? (
              t('Acordando o servidor…')
            ) : (
              t('Invocando...')
            )
          ) : (
            <>
              {t('Entrar no Saguão')}
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="ease-out-expo transition-transform duration-300 group-hover:translate-x-1"
              />
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
      {(!!provedores?.google || !!provedores?.discord) && (
        <>
          <div className="text-subtle mt-6 flex items-center gap-3 text-xs">
            <span className="bg-line h-px flex-1" />
            {t('ou continue com')}
            <span className="bg-line h-px flex-1" />
          </div>

          {/* Ícones servidos pelo próprio site (public/icones). Vinham do
              svgrepo.com: cada visita à tela de entrada entregava o IP do
              visitante a um terceiro, e a CSP (img-src) os bloquearia. */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {provedores.google && (
              <button
                onClick={() => iniciarOAuth(`${API_URL}/auth/google`)}
                className={BOTAO_SECUNDARIO}
              >
                <img src="/icones/google.svg" alt="" className="h-4 w-4" />
                Google
              </button>
            )}

            {provedores.discord && (
              <button
                onClick={() => iniciarOAuth(`${API_URL}/auth/discord`)}
                className={BOTAO_SECUNDARIO}
              >
                <img src="/icones/discord.svg" alt="" className="h-4 w-4" />
                Discord
              </button>
            )}
          </div>
        </>
      )}

      <div className="border-line mt-6 border-t pt-5 text-center">
        <p className="text-muted text-sm">
          {t('Não tem uma conta?')}{' '}
          <Link href="/register" className={`${LINK} font-medium`}>
            {t('Aliste-se')}
          </Link>
        </p>

        {/* A política precisa ser alcançável DA PÁGINA INICIAL, e não só pela
            URL direta: é o que o console do Google confere ao publicar o app
            OAuth, e é onde uma pessoa procura antes de entregar o e-mail. */}
        <p className="text-subtle mt-3 text-xs leading-relaxed">
          <Link href="/privacidade" className="hover:text-ink transition-colors">
            {t('Política de Privacidade')}
          </Link>
          <span className="mx-1.5">·</span>
          <span>{t('Projeto de fã, sem vínculo com a Wizards of the Coast')}</span>
        </p>
        {/* Quem chega aqui ainda não entrou: a troca de idioma precisa estar
            na porta, e não só nos Ajustes. */}
        <div className="mt-3 flex justify-center gap-1 text-xs" role="group" aria-label="Idioma">
          {IDIOMAS_DA_INTERFACE.map((i) => (
            <button
              key={i.codigo}
              type="button"
              onClick={() => setIdioma(i.codigo)}
              aria-pressed={idioma === i.codigo}
              className={`rounded-full px-2.5 py-0.5 transition-colors ${
                idioma === i.codigo ? 'bg-accent-soft text-accent' : 'text-subtle hover:text-ink'
              }`}
            >
              {i.codigo === 'en' ? 'EN' : 'PT'}
            </button>
          ))}
        </div>
        <AssinaturaFalkyria className="mt-3" />
      </div>
    </PortaFalkyria>
  );
}
