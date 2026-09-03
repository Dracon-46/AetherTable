'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserPlus, AlertCircle, ShieldCheck } from 'lucide-react';
import { CenaDoDragao, useDragao } from '../CenaDoDragao';
import { useAuthStore } from '../../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  // A cena do dragão é a mesma do login — ver CenaDoDragao.
  const { fase, carregar, relaxar, cuspir } = useDragao();
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Estado do cold start. O módulo `net/wake.ts` existia desde sempre, com
   * documentação e tudo — e NENHUM arquivo o importava. No plano gratuito o
   * serviço hiberna após ~15 min e a primeira requisição fica pendurada ~50 s:
   * sem este aviso, o usuário clica, nada acontece, e ele clica de novo.
   */
  const [estadoServidor, setEstadoServidor] = useState<EstadoAcordar | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    cuspir();
    setError(null);

    try {
      const acordou = await acordarApi(setEstadoServidor);
      if (!acordou) {
        setError(MENSAGEM_POR_ESTADO.falhou);
        setIsRegistering(false);
        setEstadoServidor(null);
        return;
      }

      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Falha ao registrar');
      }

      // Registro bem-sucedido! A API já retorna o token automaticamente
      // (sem precisar de um segundo fetch para login)
      setAuth(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
      setIsRegistering(false);
    } finally {
      setEstadoServidor(null);
    }
  };

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-y-auto overflow-x-hidden px-3 py-4">
      <CenaDoDragao fase={fase} carregar={carregar} relaxar={relaxar} cuspir={cuspir} />

      <div
        className={`bg-panel/80 border-panel-border relative z-10 my-auto w-full max-w-md rounded-lg border p-5 shadow-2xl backdrop-blur-md transition-transform duration-300 sm:p-7 ${error ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="bg-table-deep border-panel-border mb-3 rounded-full border p-2.5 shadow-inner">
            <ShieldCheck className="text-success h-7 w-7" />
          </div>
          <h1 className="text-text text-xl font-bold sm:text-2xl">Alistar-se</h1>
          <p className="text-text-muted mt-1 text-sm">Junte-se à mesa e forje seu destino.</p>
        </div>

        {estadoServidor === 'acordando' && (
          <div className="border-warning/40 bg-warning/10 mb-6 flex items-start gap-3 rounded border p-3">
            <AlertCircle className="text-warning mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-warning text-sm">{MENSAGEM_POR_ESTADO.acordando}</p>
          </div>
        )}

        {error && (
          <div className="bg-danger/20 border-danger/50 mb-6 flex items-start gap-3 rounded border p-3">
            <AlertCircle className="text-danger mt-0.5 h-5 w-5 flex-shrink-0" />
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              Nome de Usuário
            </label>
            <input
              type="text"
              required
              disabled={isRegistering}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-table-deep border-panel-border text-text focus:border-success focus:ring-success w-full rounded-md border px-4 py-2.5 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
              placeholder="Jace Beleren"
            />
          </div>

          <div className="space-y-2">
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              E-mail
            </label>
            <input
              type="email"
              required
              disabled={isRegistering}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-table-deep border-panel-border text-text focus:border-success focus:ring-success w-full rounded-md border px-4 py-2.5 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
              Senha (Criptografada)
            </label>
            <input
              type="password"
              required
              disabled={isRegistering}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-table-deep border-panel-border text-text focus:border-success focus:ring-success w-full rounded-md border px-4 py-2.5 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
              placeholder="••••••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isRegistering}
            onMouseEnter={carregar}
            onMouseLeave={relaxar}
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
              isRegistering
                ? 'bg-success cursor-wait text-white'
                : 'bg-success text-white hover:brightness-110 active:scale-95'
            } `}
          >
            {isRegistering ? (
              <>
                <UserPlus className="h-4 w-4 animate-bounce" />
                Criando Perfil...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Criar Conta Grátis
              </>
            )}
          </button>
        </form>

        <div className="border-panel-border mt-5 border-t pt-4 text-center">
          <p className="text-text-muted text-sm">
            Já tem uma conta?{' '}
            <Link
              href="/"
              className="text-success font-medium transition-colors hover:brightness-110"
            >
              Voltar ao Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
