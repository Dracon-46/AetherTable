'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Flame, LogIn, Swords, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { CenaDoDragao, useDragao } from './CenaDoDragao';
import { useAuthStore } from '../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
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

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden">
      <CenaDoDragao fase={fase} carregar={carregar} relaxar={relaxar} cuspir={cuspir} />

      {/* Painel de Login Glassmorphism */}
      <div
        className={`bg-panel/80 border-panel-border relative z-10 w-full max-w-md rounded-lg border p-8 shadow-2xl backdrop-blur-md transition-transform duration-300 ${error ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="bg-table-deep border-panel-border mb-4 rounded-full border p-3 shadow-inner">
            <Swords className="text-primary h-8 w-8" />
          </div>
          <h1 className="text-text text-2xl font-bold">AetherTable</h1>
          <p className="text-text-muted mt-2 text-sm">
            Prepare suas defesas, o embate vai começar.
          </p>
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

        <form onSubmit={handleLogin} className="space-y-6">
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
              className="bg-table-deep border-panel-border text-text focus:border-primary focus:ring-primary w-full rounded-md border px-4 py-3 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                Senha
              </label>
              <a
                href="#"
                className="text-primary hover:text-primary-hover text-xs transition-colors"
              >
                Esqueceu?
              </a>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isLoggingIn}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-table-deep border-panel-border text-text focus:border-primary focus:ring-primary w-full rounded-md border px-4 py-3 pr-12 transition-colors focus:outline-none focus:ring-1 disabled:opacity-50"
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
            className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-semibold transition-all duration-150 ${
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

        <div className="mt-6 flex items-center justify-between">
          <span className="border-panel-border w-1/5 border-b lg:w-1/4"></span>
          <span className="text-text-muted text-center text-xs uppercase">ou continue com</span>
          <span className="border-panel-border w-1/5 border-b lg:w-1/4"></span>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => (window.location.href = `${API_URL}/auth/google`)}
            className="border-panel-border text-text hover:bg-panel-hover flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
          >
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              alt="Google"
              className="h-5 w-5"
            />
            Google
          </button>

          <button
            onClick={() => (window.location.href = `${API_URL}/auth/discord`)}
            className="border-panel-border text-text hover:bg-panel-hover flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors"
          >
            <img
              src="https://www.svgrepo.com/show/353655/discord-icon.svg"
              alt="Discord"
              className="h-5 w-5"
            />
            Discord
          </button>

          <div className="bg-warning/10 border-warning/30 text-warning mt-2 flex flex-col items-center rounded border p-2 text-center text-[10px]">
            <AlertCircle className="mb-1 h-4 w-4" />
            <span>Usando DUMMY KEYS de OAuth (ambiente local).</span>
            <span>O login retornará erro ao redirecionar para os provedores.</span>
          </div>
        </div>

        <div className="border-panel-border mt-8 border-t pt-6 text-center">
          <p className="text-text-muted text-sm">
            Não tem uma conta?{' '}
            <Link
              href="/register"
              className="text-primary hover:text-primary-hover font-medium transition-colors"
            >
              Aliste-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
