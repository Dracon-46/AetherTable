'use client';

/**
 * /senha/redefinir?token=… — escolher a senha nova.
 *
 * ─── O TOKEN NÃO É LIDO COM `useSearchParams` ──────────────────────────────
 *
 * Seria o caminho idiomático do Next, e ele já quebrou o build deste projeto
 * antes: `useSearchParams()` obriga a rota a renderizar no cliente e o
 * `next build` falha com "useSearchParams() should be wrapped in a suspense
 * boundary" — foi exatamente o motivo de `OAuthTokenCapture` existir como
 * componente separado, e a solução adotada lá foi a mesma daqui: ler da URL
 * direto, dentro de um efeito, onde `window` existe.
 *
 * ─── E ELE SAI DA BARRA DE ENDEREÇO ASSIM QUE É LIDO ───────────────────────
 *
 * Um token de redefinição na querystring entra no histórico do navegador e no
 * cabeçalho `Referer` de qualquer requisição seguinte desta página. Ele precisa
 * viajar por ali (é um link de e-mail, não há outro lugar), mas não precisa
 * FICAR. O `replaceState` abaixo é o mesmo gesto do `#token=` do OAuth.
 *
 * ─── NÃO ENTRA NA CONTA SOZINHO ────────────────────────────────────────────
 *
 * Depois de redefinir, a tela manda entrar. O servidor não devolve sessão neste
 * caminho de propósito: quem chega aqui esqueceu a senha ou perdeu o controle
 * da conta, e emitir sessão a partir do link do e-mail transformaria o e-mail
 * no próprio fator de autenticação.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { ENTRADA, Moldura } from '../Moldura';

export default function RedefinirSenhaPage() {
  const router = useRouter();

  /**
   * `undefined` = ainda não olhamos a URL; `null` = olhamos e não havia token.
   *
   * Os dois estados são distintos porque, sem isso, o primeiro render (antes do
   * efeito) mostraria "link inválido" por um instante para TODO mundo que
   * chegasse por um link perfeitamente válido.
   */
  const [token, setToken] = useState<string | null | undefined>(undefined);

  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    const daUrl = new URLSearchParams(window.location.search).get('token');
    setToken(daUrl && daUrl.length > 0 ? daUrl : null);

    if (daUrl) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  /**
   * As duas conferências acontecem aqui, não no servidor.
   *
   * Nenhuma delas é regra do domínio — o servidor não tem opinião sobre digitar
   * a mesma senha duas vezes. São proteção contra erro de digitação numa caixa
   * que esconde o que foi escrito, e o lugar de detectar isso é onde a pessoa
   * ainda está com as mãos no teclado. O mínimo de 8 é o mesmo do cadastro e o
   * servidor o exige de novo.
   */
  const divergem = confirmacao.length > 0 && novaSenha !== confirmacao;
  const curta = novaSenha.length > 0 && novaSenha.length < 8;
  const podeEnviar = Boolean(token) && novaSenha.length >= 8 && novaSenha === confirmacao;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEnviar || enviando || !token) return;

    setEnviando(true);
    setErro(null);

    try {
      await api('/auth/senha/redefinir', {
        method: 'POST',
        body: { token, novaSenha },
        publica: true,
      });
      setPronto(true);
    } catch (erroDaApi) {
      setErro(mensagemDaApi(erroDaApi));
    } finally {
      setEnviando(false);
    }
  }

  if (token === undefined) {
    return (
      <Moldura
        icone={<Loader2 className="text-primary h-7 w-7 animate-spin" />}
        titulo="Um instante"
        subtitulo="Conferindo o link…"
      >
        <span className="sr-only">Carregando</span>
      </Moldura>
    );
  }

  if (token === null) {
    return (
      <Moldura
        icone={<AlertCircle className="text-danger h-7 w-7" />}
        titulo="Link incompleto"
        subtitulo="Este endereço chegou sem o código de redefinição."
      >
        <p className="text-text-muted text-sm leading-relaxed">
          Abra o link direto do e-mail que você recebeu, sem editar o endereço. Se ele já passou de
          30 minutos, peça outro.
        </p>
        <Link
          href="/senha/esqueci"
          className="bg-primary hover:bg-primary-hover mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          <KeyRound className="h-4 w-4" />
          Pedir um link novo
        </Link>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura
        icone={<ShieldCheck className="text-success h-7 w-7" />}
        titulo="Senha redefinida"
        subtitulo="Agora entre com ela."
      >
        <div className="border-success/30 bg-success/10 text-success flex items-start gap-3 rounded border p-3 text-sm">
          <Check className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>
            Pronto. <strong>Todas as sessões desta conta foram encerradas</strong> — outro
            navegador, outro computador, o celular. Se alguém tinha entrado na sua conta, essa
            pessoa acabou de sair.
          </p>
        </div>

        <button
          onClick={() => router.push('/')}
          className="bg-primary hover:bg-primary-hover mt-4 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          Entrar no Saguão
        </button>
      </Moldura>
    );
  }

  return (
    <Moldura
      icone={<KeyRound className="text-primary h-7 w-7" />}
      titulo="Escolha uma senha nova"
      subtitulo="Ela substitui a anterior imediatamente."
      tremer={Boolean(erro)}
    >
      {erro && (
        <div className="bg-danger/20 border-danger/50 mb-4 flex items-start gap-3 rounded border p-3">
          <AlertCircle className="text-danger mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="text-danger text-sm">
            <p>{erro}</p>
            <Link href="/senha/esqueci" className="mt-1 inline-block font-semibold underline">
              Pedir um link novo
            </Link>
          </div>
        </div>
      )}

      <p className="text-text-muted mb-4 text-sm leading-relaxed">
        Ao redefinir, <strong>todas as sessões desta conta são encerradas</strong>. É de propósito:
        quem redefine a senha em geral desconfia que outra pessoa entrou.
      </p>

      <form onSubmit={enviar} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="nova-senha"
            className="text-text-muted block text-xs font-semibold uppercase tracking-wider"
          >
            Senha nova
          </label>
          <input
            id="nova-senha"
            type="password"
            autoComplete="new-password"
            required
            disabled={enviando}
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className={ENTRADA}
            placeholder="••••••••••••"
          />
          {curta && <p className="text-danger mt-1.5 text-xs">Precisa de ao menos 8 caracteres.</p>}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirmacao"
            className="text-text-muted block text-xs font-semibold uppercase tracking-wider"
          >
            Repita a senha nova
          </label>
          <input
            id="confirmacao"
            type="password"
            autoComplete="new-password"
            required
            disabled={enviando}
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            className={ENTRADA}
            placeholder="••••••••••••"
          />
          {divergem && <p className="text-danger mt-1.5 text-xs">As duas não conferem.</p>}
        </div>

        <button
          type="submit"
          disabled={!podeEnviar || enviando}
          className="bg-primary hover:bg-primary-hover flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {enviando ? 'Redefinindo…' : 'Redefinir senha'}
        </button>
      </form>
    </Moldura>
  );
}
