'use client';

import { useState } from 'react';
import { Flame, LogIn, Swords, AlertCircle } from 'lucide-react';
import { FireCanvas } from './FireCanvas';
import { useAuthStore } from '../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  const [isHovering, setIsHovering] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError(null);
    
    try {
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
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden">
      {/* Fundo do Dragão com overlay e efeito de fogo */}
      <div 
        className={`absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700
          ${isLoggingIn ? 'animate-fire-breathe' : ''}`}
        style={{ backgroundImage: 'url("/dragon_bg.png")' }}
      >
        <div className="absolute inset-0 bg-table-deep/70 backdrop-blur-[2px]" />
      </div>

      {/* Partículas de Fogo que literalmente sagram da tela */}
      <FireCanvas active={isLoggingIn} />
      
      {/* Luz do Sopro do Dragão que interage com o botão */}
      {isHovering && !isLoggingIn && (
        <div className="pointer-events-none absolute inset-0 z-0 bg-orange-600/10 transition-opacity duration-500 animate-pulse mix-blend-color-dodge" />
      )}

      {/* Painel de Login Glassmorphism */}
      <div className={`relative z-10 w-full max-w-md p-8 bg-panel/80 backdrop-blur-md rounded-lg border border-panel-border shadow-2xl transition-transform duration-300 ${error ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}>
        
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="p-3 bg-table-deep rounded-full border border-panel-border mb-4 shadow-inner">
            <Swords className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-text">AetherTable</h1>
          <p className="text-text-muted mt-2 text-sm">Prepare suas defesas, o embate vai começar.</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded bg-danger/20 border border-danger/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-text-muted uppercase">
              E-mail
            </label>
            <input 
              type="email" 
              required
              disabled={isLoggingIn}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-table-deep border border-panel-border rounded-md text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold tracking-wider text-text-muted uppercase">
                Senha
              </label>
              <a href="#" className="text-xs text-primary hover:text-primary-hover transition-colors">
                Esqueceu?
              </a>
            </div>
            <input 
              type="password" 
              required
              disabled={isLoggingIn}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-table-deep border border-panel-border rounded-md text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-50"
              placeholder="••••••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoggingIn}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            className={`
              w-full py-3 px-4 flex items-center justify-center gap-2 rounded-md font-semibold text-sm transition-all duration-150
              ${isLoggingIn 
                ? 'bg-danger text-white cursor-wait' 
                : 'bg-primary text-white hover:bg-primary-hover active:scale-95'
              }
            `}
          >
            {isLoggingIn ? (
              <>
                <Flame className="w-4 h-4 animate-bounce" />
                Invocando...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Entrar no Saguão
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-panel-border text-center">
          <p className="text-sm text-text-muted">
            Não tem uma conta?{' '}
            <a href="/register" className="text-primary hover:text-primary-hover transition-colors font-medium">
              Aliste-se
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
