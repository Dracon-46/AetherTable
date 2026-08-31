'use client';

/**
 * OAuthTokenCapture — troca o `?token=` do redirect de OAuth pela sessão.
 *
 * POR QUE VIROU UM COMPONENTE SEPARADO
 *
 * `useSearchParams()` obriga o Next a renderizar a rota no cliente. Chamado
 * direto no `DashboardLayout`, ele arrastava TODAS as páginas do dashboard para
 * fora da pré-renderização — e o `next build` falhava com
 * "useSearchParams() should be wrapped in a suspense boundary", derrubando o
 * build inteiro em /dashboard/decks. O deploy de produção estava quebrado.
 *
 * Isolado aqui e envolvido num `<Suspense>`, o bail-out para CSR fica contido
 * neste componente, que não renderiza nada.
 */

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';
import { API_URL } from '@/lib/api';

export function OAuthTokenCapture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) return;

    let ativo = true;
    // Estava com `http://localhost:3333/api/users/me` escrito à mão: em
    // qualquer ambiente que não fosse a máquina do dev, o login por OAuth
    // redirecionava e morria aqui, em silêncio.
    fetch(`${API_URL}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((userData) => {
        if (!ativo || !userData || userData.statusCode) return;
        setAuth(token, userData);
        router.replace('/dashboard');
      })
      .catch((err) => console.error('Falha ao concluir o login OAuth:', err));

    return () => {
      ativo = false;
    };
  }, [searchParams, setAuth, router]);

  return null;
}
