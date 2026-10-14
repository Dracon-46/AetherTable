'use client';

/**
 * ExcluirConta.tsx — sair do produto sem pedir a ninguém.
 *
 * O backend sabia desativar uma conta (`UsersService.softDelete`) e nenhuma
 * rota o chamava: a única forma de ir embora era pedir a um administrador. A
 * LGPD dá ao titular o direito de pedir a eliminação, e o caminho tem de estar
 * ao alcance dele — na tela de ajustes, não num e-mail para o suporte.
 *
 * ─── APAGAR É APAGAR ──────────────────────────────────────────────────────
 *
 * Confirmado o nome (e a senha, se a conta tem), a conta e os dados dela são
 * apagados do banco NA HORA — não desativados à espera de um administrador.
 * Quem pediu a exclusão já fez o pedido; exigir outro, por outro canal, era
 * transformar um direito num chamado de suporte. A política de privacidade
 * (/privacidade) diz exatamente isto, e as duas precisam continuar dizendo a
 * mesma coisa.
 */

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { useAuthStore } from '@/store/auth.store';

const ENTRADA =
  'bg-table-deep border-panel-border text-text focus:border-danger w-full rounded-md border px-4 py-3 transition-colors focus:outline-none';

export function ExcluirConta() {
  const username = useAuthStore((s) => s.user?.username ?? '');
  const logout = useAuthStore((s) => s.logout);

  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Conferir o nome aqui também: o botão só acende com o nome exato, e a
  // pessoa vê na hora que digitou errado em vez de esperar o servidor.
  const podeEnviar = Boolean(username) && confirmacao.trim() === username && !enviando;

  async function excluir(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    try {
      await api('/auth/excluir-conta', {
        method: 'POST',
        body: { confirmacao: confirmacao.trim(), ...(senha ? { senha } : {}) },
      });
      // O servidor já derrubou as sessões; limpar o token local evita uma
      // última chamada autenticada recusada com "sessão expirada".
      logout();
      window.location.href = '/?conta=excluida';
    } catch (falha) {
      setErro(mensagemDaApi(falha));
      setEnviando(false);
    }
  }

  return (
    <section className="border-danger/40 bg-danger/5 mt-8 rounded-xl border p-6 shadow-lg">
      <h2 className="text-danger mb-2 flex items-center gap-2 text-lg font-bold">
        <AlertTriangle className="h-5 w-5" />
        Excluir minha conta
      </h2>
      <p className="text-text-muted mb-4 text-sm leading-relaxed">
        A conta é apagada na hora, de forma definitiva, junto com os seus decks, preferências,
        cosméticos e curtidas. Você sai de todas as sessões. Fica só o que não identifica você: a
        contagem de partidas jogadas. Isto não tem volta — veja a{' '}
        <a href="/privacidade" className="text-primary underline">
          política de privacidade
        </a>
        .
      </p>

      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="border-danger/60 text-danger hover:bg-danger flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-bold transition-colors hover:text-white"
        >
          <Trash2 className="h-4 w-4" />
          Quero excluir minha conta
        </button>
      ) : (
        <form onSubmit={excluir} className="flex max-w-md flex-col gap-3">
          <label className="text-text text-sm">
            Para confirmar, digite o seu nome de usuário:{' '}
            <span className="font-mono font-bold">{username}</span>
            <input
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="off"
              className={`${ENTRADA} mt-1.5`}
              aria-label="Nome de usuário, para confirmar"
            />
          </label>
          <label className="text-text text-sm">
            Senha
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              className={`${ENTRADA} mt-1.5`}
            />
            <span className="text-text-faint mt-1 block text-xs">
              Quem entra com Google ou Discord não tem senha: deixe em branco.
            </span>
          </label>

          {erro && <p className="text-danger text-sm">{erro}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!podeEnviar}
              className="bg-danger hover:bg-danger-hover flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold text-white transition-colors disabled:opacity-40"
            >
              {enviando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Excluir minha conta
            </button>
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                setConfirmacao('');
                setSenha('');
                setErro(null);
              }}
              className="text-text-muted hover:text-text rounded-md px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
