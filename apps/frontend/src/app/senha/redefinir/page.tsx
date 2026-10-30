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

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { BOTAO, ENTRADA, Moldura } from '../Moldura';

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

  /**
   * ─── O STRICTMODE LIA A URL JÁ LIMPA ─────────────────────────────────────
   *
   * O efeito lia o token e o apagava da barra de endereço. O StrictMode roda o
   * efeito DUAS vezes: a segunda leitura encontrava a URL já sem token e
   * gravava `null` por cima — em desenvolvimento, todo link de e-mail válido
   * abria em "Link incompleto". O ref guarda o que a PRIMEIRA leitura achou,
   * e as seguintes repetem esse resultado em vez de olhar a URL de novo.
   */
  const lidoDaUrl = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lidoDaUrl.current === undefined) {
      const daUrl = new URLSearchParams(window.location.search).get('token');
      lidoDaUrl.current = daUrl && daUrl.length > 0 ? daUrl : null;

      if (daUrl) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    setToken(lidoDaUrl.current);
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
        icone={<Loader2 className="text-accent h-[17px] w-[17px] animate-spin" />}
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
        icone={<AlertCircle className="text-danger h-[17px] w-[17px]" />}
        titulo="Link incompleto"
        subtitulo="Este endereço chegou sem o código de redefinição."
      >
        <p className="text-muted text-sm leading-relaxed">
          Abra o link direto do e-mail que você recebeu, sem editar o endereço. Se ele já passou de
          30 minutos, peça outro.
        </p>
        <Link href="/senha/esqueci" className={`${BOTAO} mt-4`}>
          <KeyRound className="h-4 w-4" />
          Pedir um link novo
        </Link>
      </Moldura>
    );
  }

  if (pronto) {
    return (
      <Moldura
        icone={<ShieldCheck className="text-success h-[17px] w-[17px]" />}
        titulo="Senha redefinida"
        subtitulo="Agora entre com ela."
      >
        <div className="bg-success/10 text-success flex items-start gap-3 rounded-xl px-4 py-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Pronto. <strong>Todas as sessões desta conta foram encerradas</strong> — outro
            navegador, outro computador, o celular. Se alguém tinha entrado na sua conta, essa
            pessoa acabou de sair.
          </p>
        </div>

        <button onClick={() => router.push('/')} className={`${BOTAO} mt-4`}>
          Entrar no Saguão
        </button>
      </Moldura>
    );
  }

  return (
    <Moldura
      icone={<KeyRound className="text-accent h-[17px] w-[17px]" />}
      titulo="Escolha uma senha nova"
      subtitulo="Ela substitui a anterior imediatamente."
      tremer={Boolean(erro)}
    >
      {erro && (
        <div className="bg-danger-soft text-danger mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p>{erro}</p>
            <Link href="/senha/esqueci" className="mt-1 inline-block font-semibold underline">
              Pedir um link novo
            </Link>
          </div>
        </div>
      )}

      <p className="text-muted mb-4 text-sm leading-relaxed">
        Ao redefinir, <strong>todas as sessões desta conta são encerradas</strong>. É de propósito:
        quem redefine a senha em geral desconfia que outra pessoa entrou.
      </p>

      <form onSubmit={enviar} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="nova-senha" className="text-muted block text-xs font-medium">
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

        <div className="flex flex-col gap-2">
          <label htmlFor="confirmacao" className="text-muted block text-xs font-medium">
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

        <button type="submit" disabled={!podeEnviar || enviando} className={BOTAO}>
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
