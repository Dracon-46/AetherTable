'use client';

/**
 * OAuthTokenCapture — troca o `#token=` do redirect de OAuth pela sessão.
 *
 * ─── O TOKEN SAIU DA QUERYSTRING E FOI PARA O FRAGMENTO ────────────────────
 *
 * Era `?token=<jwt>`, e a querystring de um redirect vai para lugares que
 * ninguém controla: o histórico do navegador, o cabeçalho `Referer` de toda
 * requisição seguinte daquela página, e o log de qualquer proxy ou CDN no
 * caminho — que costumam registrar a URL inteira.
 *
 * O FRAGMENTO nunca é enviado ao servidor. Ele existe só no navegador, e essa
 * é a diferença entre um token que vaza para infraestrutura de terceiros e um
 * que não vaza. Ainda assim ele é apagado assim que lido — ver o
 * `replaceState` abaixo.
 *
 * POR QUE CONTINUA UM COMPONENTE SEPARADO
 *
 * Ele lia `useSearchParams()`, que obriga o Next a renderizar a rota no
 * cliente: chamado direto no `DashboardLayout`, arrastava TODAS as páginas do
 * painel para fora da pré-renderização e o `next build` falhava com
 * "useSearchParams() should be wrapped in a suspense boundary".
 *
 * O fragmento não passa por hook nenhum do Next, então esse motivo específico
 * deixou de valer. O componente continua separado porque a captura de sessão é
 * um assunto próprio — e o `<Suspense>` do layout ficou inofensivo em vez de
 * necessário.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';
import { API_URL } from '@/lib/api';

export function OAuthTokenCapture() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  /**
   * `reactStrictMode` invoca o efeito duas vezes. A segunda já não acha o
   * fragmento — ele foi apagado — mas a primeira ainda pode estar buscando o
   * perfil, e sem o ref um erro de rede na primeira reabriria a porta para a
   * segunda tentar com um token que já não está em lugar nenhum.
   */
  const jaProcessou = useRef(false);

  useEffect(() => {
    if (jaProcessou.current) return;

    const fragmento = window.location.hash;
    if (!fragmento.startsWith('#token=')) return;

    jaProcessou.current = true;
    const token = decodeURIComponent(fragmento.slice('#token='.length));

    /**
     * APAGA O FRAGMENTO ANTES DE QUALQUER `await`.
     *
     * Deixar a limpeza para depois da requisição manteria o token na barra de
     * endereço durante toda a ida ao servidor — justamente a janela em que
     * alguém olha a tela por cima do ombro ou tira um screenshot.
     */
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

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
      .catch((err) => {
        console.error('Falha ao concluir o login OAuth:', err);
        jaProcessou.current = false;
      });

    return () => {
      ativo = false;
    };
  }, [setAuth, router]);

  return null;
}
