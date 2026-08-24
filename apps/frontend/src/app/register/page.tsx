'use client';

import { useState } from 'react';
import { UserPlus, AlertCircle, ShieldCheck } from 'lucide-react';
import { FireCanvas } from '../FireCanvas';
import { useAuthStore } from '../../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  const [isHovering, setIsHovering] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    setError(null);
    
    try {
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
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden">
      <div 
        className={`absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700
          ${isRegistering ? 'animate-fire-breathe' : ''}`}
        style={{ backgroundImage: 'url("/dragon_bg.png")' }}
      >
        <div className="absolute inset-0 bg-table-deep/70 backdrop-blur-[2px]" />
      </div>

      <FireCanvas active={isRegistering} />
      
      {isHovering && !isRegistering && (
        <div className="pointer-events-none absolute inset-0 z-0 bg-orange-600/10 transition-opacity duration-500 animate-pulse mix-blend-color-dodge" />
      )}

      <div className={`relative z-10 w-full max-w-md p-8 bg-panel/80 backdrop-blur-md rounded-lg border border-panel-border shadow-2xl transition-transform duration-300 ${error ? 'animate-[shake_0.2s_ease-in-out]' : ''}`}>
        
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="p-3 bg-table-deep rounded-full border border-panel-border mb-4 shadow-inner">
            <ShieldCheck className="w-8 h-8 text-success" />
          </div>
          <h1 className="text-2xl font-bold text-text">Alistar-se</h1>
          <p className="text-text-muted mt-2 text-sm">Junte-se à mesa e forje seu destino.</p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded bg-danger/20 border border-danger/50 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-text-muted uppercase">
              Nome de Usuário
            </label>
            <input 
              type="text" 
              required
              disabled={isRegistering}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-table-deep border border-panel-border rounded-md text-text focus:outline-none focus:border-success focus:ring-1 focus:ring-success transition-colors disabled:opacity-50"
              placeholder="Jace Beleren"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-text-muted uppercase">
              E-mail
            </label>
            <input 
              type="email" 
              required
              disabled={isRegistering}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-table-deep border border-panel-border rounded-md text-text focus:outline-none focus:border-success focus:ring-1 focus:ring-success transition-colors disabled:opacity-50"
              placeholder="seuemail@exemplo.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-text-muted uppercase">
              Senha (Criptografada)
            </label>
            <input 
              type="password" 
              required
              disabled={isRegistering}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-table-deep border border-panel-border rounded-md text-text focus:outline-none focus:border-success focus:ring-1 focus:ring-success transition-colors disabled:opacity-50"
              placeholder="••••••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isRegistering}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            className={`
              w-full py-3 px-4 flex items-center justify-center gap-2 rounded-md font-semibold text-sm transition-all duration-150
              ${isRegistering 
                ? 'bg-success text-white cursor-wait' 
                : 'bg-success text-white hover:brightness-110 active:scale-95'
              }
            `}
          >
            {isRegistering ? (
              <>
                <UserPlus className="w-4 h-4 animate-bounce" />
                Criando Perfil...
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Criar Conta Grátis
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-panel-border text-center">
          <p className="text-sm text-text-muted">
            Já tem uma conta?{' '}
            <a href="/" className="text-success hover:brightness-110 transition-colors font-medium">
              Voltar ao Login
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
