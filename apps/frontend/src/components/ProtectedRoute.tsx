'use client';

/**
 * ProtectedRoute — porteiro das telas autenticadas.
 *
 * ─── O BUG QUE ESTA VERSÃO CORRIGE ─────────────────────────────────────────
 *
 * O `authStore` usa o middleware `persist` do zustand, que reidrata do
 * `localStorage` de forma ASSÍNCRONA — depois do primeiro render do cliente.
 * A versão anterior fazia:
 *
 *     useEffect(() => { if (!isAuthenticated()) router.push('/'); }, [...]);
 *
 * No primeiro render `accessToken` ainda é `null`, mesmo para quem está
 * logado. O efeito rodava, via "não autenticado" e mandava o usuário para o
 * login. Efeito prático: **dar F5 em qualquer tela do dashboard deslogava**.
 * Não havia erro nem log — parecia sessão expirando sozinha.
 *
 * A correção é esperar a reidratação terminar antes de decidir qualquer coisa.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';

/**
 * ─── O PORTEIRO JOGAVA FORA O TOKEN DO OAUTH ───────────────────────────────
 *
 * O backend conclui o OAuth redirecionando para `/dashboard#token=…`. Quem
 * chega assim ainda NÃO tem sessão — é justamente o token que vai criá-la —,
 * então este porteiro mandava para `/` antes de o `OAuthTokenCapture` (que
 * mora DENTRO dele, no layout do painel) sequer montar. O `replace('/')`
 * levava junto o fragmento, e o login por Google/Discord terminava na tela de
 * login, sem erro nenhum, para todo mundo que não estivesse logado — ou seja,
 * para todo mundo que usa o botão.
 *
 * Agora o fragmento viaja com o redirecionamento e a tela de login, que também
 * monta o `OAuthTokenCapture`, conclui a entrada. Só `#token=` é repassado:
 * qualquer outro fragmento é da página que ficou para trás.
 */
function fragmentoDeOAuth(): string {
  if (typeof window === 'undefined') return '';
  return window.location.hash.startsWith('#token=') ? window.location.hash : '';
}

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);

  // Começa SEMPRE em `false`: o servidor não tem sessão, então o primeiro
  // render do cliente precisa ser idêntico ao HTML do servidor, senão o React
  // acusa mismatch de hidratação. A decisão real acontece no efeito abaixo,
  // que só roda no navegador.
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    const persistencia = useAuthStore.persist;
    // Se o `persist` não instalou sua API (storage indisponível), não há o que
    // esperar: seguimos com o que estiver em memória em vez de travar a tela.
    if (!persistencia) {
      setHidratado(true);
      return;
    }
    // `hasHydrated()` já responde `true` quando a reidratação terminou antes de
    // montarmos — o listener sozinho perderia esse caso e a tela ficaria presa
    // no "verificando".
    if (persistencia.hasHydrated()) {
      setHidratado(true);
      return;
    }
    return persistencia.onFinishHydration(() => setHidratado(true));
  }, []);

  useEffect(() => {
    if (!hidratado) return;
    if (!accessToken) router.replace(`/${fragmentoDeOAuth()}`);
  }, [hidratado, accessToken, router]);

  if (!hidratado || !accessToken) {
    return (
      <div className="bg-table-deep text-text flex min-h-dvh w-full items-center justify-center">
        <div className="flex animate-pulse flex-col items-center">
          <div className="border-primary mb-4 h-12 w-12 animate-spin rounded-full border-4 border-t-transparent" />
          <p className="text-sm font-medium tracking-wider">VERIFICANDO RUNAS…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
