'use client';

/**
 * TrocarSenha.tsx — trocar a própria senha.
 *
 * ─── O QUE FALTAVA ─────────────────────────────────────────────────────────
 *
 * Não havia caminho nenhum. O painel administrativo sabia REDEFINIR a senha de
 * alguém, e a própria pessoa não tinha como trocar a sua — a única saída para
 * quem quisesse mudar era pedir a um administrador, que geraria uma senha
 * temporária e a entregaria por fora. Para uma troca de rotina isso é pior do
 * que não poder trocar: transforma uma decisão privada num pedido de suporte,
 * e coloca uma senha em trânsito por um canal qualquer.
 *
 * ─── A SESSÃO DESTA ABA SOBREVIVE, AS OUTRAS NÃO ───────────────────────────
 *
 * O servidor derruba todas as sessões da conta e devolve um token novo para
 * esta. É o comportamento certo — quem troca a senha geralmente suspeita de
 * invasão — mas é surpreendente o bastante para estar escrito na tela ANTES de
 * a pessoa clicar, e não depois.
 */

import { useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useAuthStore } from '@/store/auth.store';

const ENTRADA =
  'bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 transition-colors focus:outline-none';

export function TrocarSenha() {
  const definirToken = useAuthStore((s) => s.setAccessToken);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  /**
   * A confirmação é conferida AQUI, não no servidor.
   *
   * Ela não é uma regra do domínio — o servidor não tem opinião sobre digitar
   * a mesma senha duas vezes. É proteção contra erro de digitação numa caixa
   * que esconde o que foi escrito, e o lugar de detectar isso é onde a pessoa
   * ainda está com as mãos no teclado.
   */
  const divergem = confirmacao.length > 0 && novaSenha !== confirmacao;
  const curta = novaSenha.length > 0 && novaSenha.length < 8;
  const podeEnviar =
    senhaAtual.length > 0 && novaSenha.length >= 8 && novaSenha === confirmacao && !enviando;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    setPronto(false);

    try {
      const r = await api<{ accessToken: string }>('/auth/senha', {
        method: 'POST',
        body: { senhaAtual, novaSenha },
      });

      /**
       * Guardar o token novo é o que impede esta aba de cair junto.
       *
       * O corte de sessão no servidor invalida TODO token emitido antes da
       * troca — inclusive o que acabou de fazer esta chamada. Sem esta linha,
       * a próxima requisição desta aba levaria 401 e o jogador seria deslogado
       * pelo ato de trocar a senha.
       */
      if (r?.accessToken) definirToken(r.accessToken);

      setSenhaAtual('');
      setNovaSenha('');
      setConfirmacao('');
      setPronto(true);
    } catch (erroDaApi) {
      setErro(mensagemDaApi(erroDaApi));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="bg-panel border-panel-border mb-8 rounded-xl border p-6 shadow-lg">
      <h2 className="text-text mb-1 flex items-center gap-2 text-lg font-bold">
        <KeyRound className="text-primary h-5 w-5" /> Trocar a senha
      </h2>
      <p className="text-text-muted mb-5 text-sm leading-relaxed">
        Ao trocar, <strong>todas as outras sessões desta conta são encerradas</strong> — outro
        navegador, outro computador, o celular. Esta aba continua conectada.
      </p>

      <form onSubmit={enviar} className="space-y-5">
        <div>
          <label
            htmlFor="senha-atual"
            className="text-text-muted mb-2 block text-sm font-bold uppercase"
          >
            Senha atual
          </label>
          <input
            id="senha-atual"
            type="password"
            autoComplete="current-password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            className={ENTRADA}
          />
        </div>

        <div>
          <label
            htmlFor="senha-nova"
            className="text-text-muted mb-2 block text-sm font-bold uppercase"
          >
            Senha nova
          </label>
          <input
            id="senha-nova"
            type="password"
            autoComplete="new-password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className={ENTRADA}
          />
          {curta && <p className="text-danger mt-1.5 text-xs">Precisa de ao menos 8 caracteres.</p>}
        </div>

        <div>
          <label
            htmlFor="senha-confirmacao"
            className="text-text-muted mb-2 block text-sm font-bold uppercase"
          >
            Repita a senha nova
          </label>
          <input
            id="senha-confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            className={ENTRADA}
          />
          {divergem && <p className="text-danger mt-1.5 text-xs">As duas não conferem.</p>}
        </div>

        {erro && (
          <p className="border-danger/30 bg-danger/10 text-danger rounded-md border p-3 text-sm">
            {erro}
          </p>
        )}

        {pronto && (
          <p className="border-success/30 bg-success/10 text-success flex items-center gap-2 rounded-md border p-3 text-sm">
            <Check className="h-4 w-4 shrink-0" />
            Senha trocada. As outras sessões foram encerradas.
          </p>
        )}

        <div className="border-panel-border flex justify-end border-t pt-4">
          <button
            type="submit"
            disabled={!podeEnviar}
            className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-6 py-3 font-bold text-white shadow-md transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <KeyRound className="h-5 w-5" />
            )}
            {enviando ? 'Trocando…' : 'Trocar senha'}
          </button>
        </div>
      </form>
    </section>
  );
}
