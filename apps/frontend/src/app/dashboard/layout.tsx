'use client';

/**
 * DashboardLayout — a casca das telas autenticadas.
 *
 * ─── O QUE MUDOU E POR QUÊ ─────────────────────────────────────────────────
 *
 * O menu tinha DOIS estados: fora da tela (< 768 px) ou 256 px fixos. Faltava
 * o estado do meio, que é o mais pedido num notebook: continuar navegável
 * ocupando pouco. Em 1366 px, 256 px são 19 % da largura reservados a quatro
 * links — dentro do deckbuilder, onde o painel de busca e a lista de cartas
 * disputam espaço horizontal, isso é a diferença entre três e quatro colunas
 * de arte na galeria.
 *
 * Agora são três: gaveta (celular), trilha de ícones de 64 px e painel de
 * 256 px. A escolha é lembrada (`useAparencia`), porque quem minimiza o menu
 * quer o menu minimizado — não quer minimizá-lo a cada visita.
 *
 * A navegação em si virou UMA LISTA de dados em vez de quatro blocos de JSX
 * repetidos. Os quatro estavam divergindo: `pathname === '/dashboard'` num,
 * `pathname.startsWith(...)` noutro, e nada garantia que o próximo item
 * nascesse com o mesmo comportamento.
 */

import {
  LogOut,
  Settings,
  User,
  Home,
  LibraryBig,
  PanelLeftClose,
  PanelLeft,
  ShieldAlert,
} from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useAuthStore } from '../../store/auth.store';
import { useAparencia } from '../../store/aparencia.store';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { OAuthTokenCapture } from '../../components/OAuthTokenCapture';
import { useSouAdmin } from '../../admin/useAdmin';
import { useHidratarPreferencias } from '../../store/useHidratarPreferencias';

interface ItemDeMenu {
  href: string;
  rotulo: string;
  Icone: typeof Home;
  /** `true` = a rota casa por prefixo (as subrotas dela também acendem). */
  prefixo?: boolean;
}

const NAVEGACAO: ItemDeMenu[] = [
  { href: '/dashboard', rotulo: 'Início', Icone: Home },
  // Prefixo: `/dashboard/decks/<id>` é a MESMA seção, e sem isto o item
  // apagava assim que o usuário abria um grimório — a navegação perdia a
  // referência de onde ele estava justamente na tela mais profunda.
  { href: '/dashboard/decks', rotulo: 'Meus Grimórios', Icone: LibraryBig, prefixo: true },
  { href: '/dashboard/profile', rotulo: 'Meu Perfil', Icone: User },
  { href: '/dashboard/settings', rotulo: 'Ajustes', Icone: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const recolhido = useAparencia((s) => s.menuRecolhido);
  const alternarMenu = useAparencia((s) => s.alternarMenu);

  /**
   * ─── O PAINEL PRECISAVA DE UMA PORTA ───────────────────────────────────────
   *
   * O backoffice existe em `/admin` e nada na interface levava até lá: o
   * administrador teria de digitar a URL. Um painel que só quem sabe o endereço
   * encontra é um painel que ninguém usa.
   *
   * `useSouAdmin` pergunta ao SERVIDOR, não ao `role` guardado no login: o
   * token vale sete dias, e uma despromoção não teria efeito nesse período. O
   * item só aparece quando o servidor confirma o papel — e mesmo que alguém
   * force a navegação, é o `PapeisGuard` do backend que decide.
   */
  const { data: sessaoAdmin } = useSouAdmin();

  // Traz cosméticos e atalhos salvos na conta. Ver `useHidratarPreferencias`.
  useHidratarPreferencias();

  // Fecha a gaveta ao trocar de rota.
  useEffect(() => {
    setGavetaAberta(false);
  }, [pathname]);

  // `Esc` fecha a gaveta. Sem isto, o único jeito de fechá-la no celular era
  // acertar o véu atrás dela — que num aparelho estreito é uma faixa fina.
  useEffect(() => {
    if (!gavetaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGavetaAberta(false);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  const estaAtivo = (item: ItemDeMenu) =>
    item.prefixo ? pathname.startsWith(item.href) : pathname === item.href;

  /** Na gaveta do celular o menu é SEMPRE largo: ali espaço não é o problema. */
  const larguraDaTrilha = recolhido ? 'md:w-16' : 'md:w-64';

  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <OAuthTokenCapture />
      </Suspense>
      <div className="bg-table-deep text-text flex h-dvh w-full overflow-hidden font-sans">
        {/* ── Cabeçalho do celular ───────────────────────────────────────── */}
        <header className="border-panel-border bg-panel/95 absolute top-0 z-30 flex h-16 w-full items-center justify-between border-b px-4 backdrop-blur md:hidden">
          <span className="text-text text-lg font-bold">AetherTable</span>
          <button
            onClick={() => setGavetaAberta((v) => !v)}
            className="text-text hover:bg-panel-hover rounded-md p-2 transition-colors"
            aria-label={gavetaAberta ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={gavetaAberta}
          >
            {gavetaAberta ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </header>

        {gavetaAberta && (
          <div
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setGavetaAberta(false)}
            aria-hidden
          />
        )}

        {/* ── Menu lateral ───────────────────────────────────────────────── */}
        <aside
          className={`bg-panel border-panel-border fixed left-0 top-0 z-30 flex h-full w-64 transform flex-col justify-between border-r shadow-2xl transition-[transform,width] duration-300 ease-in-out md:relative md:translate-x-0 ${
            gavetaAberta ? 'translate-x-0' : '-translate-x-full'
          } ${larguraDaTrilha} pt-16 md:pt-0`}
          aria-label="Navegação principal"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Cartão do usuário. Recolhido, sobra o avatar centralizado — o
                nome truncado em 64 px seria uma letra e meia, o que informa
                menos do que a inicial já informa. */}
            <div
              className={`border-panel-border flex items-center gap-3 border-b p-4 md:p-6 ${
                recolhido ? 'md:justify-center md:px-0' : ''
              }`}
            >
              <div
                className="bg-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-white shadow-md"
                title={user?.username || 'Planeswalker'}
              >
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className={`flex min-w-0 flex-col ${recolhido ? 'md:hidden' : ''}`}>
                <span className="truncate text-sm font-semibold">
                  {user?.username || 'Planeswalker'}
                </span>
                <span className="text-success flex items-center gap-1 text-xs">
                  <span className="bg-success h-2 w-2 animate-pulse rounded-full" />
                  Conectado
                </span>
              </div>
            </div>

            <nav className="mt-3 space-y-1 p-2 md:mt-4 md:space-y-2 md:p-4">
              {NAVEGACAO.map((item) => {
                const ativo = estaAtivo(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={ativo ? 'page' : undefined}
                    // `title` só quando recolhido: com o rótulo visível, a
                    // tooltip repetindo o texto ao lado é ruído.
                    title={recolhido ? item.rotulo : undefined}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                      recolhido ? 'md:justify-center md:px-0' : ''
                    } ${ativo ? 'bg-primary/20 text-primary' : 'text-text hover:bg-panel-hover'}`}
                  >
                    <item.Icone className="h-5 w-5 shrink-0" />
                    <span className={`truncate font-medium ${recolhido ? 'md:hidden' : ''}`}>
                      {item.rotulo}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="border-panel-border shrink-0 border-t p-2 md:p-4">
            {/* A porta do backoffice. Fica no rodapé, separada da navegação
                normal: é uma área de trabalho diferente, não uma seção do
                aplicativo do jogador. */}
            {sessaoAdmin && (
              <Link
                href="/admin"
                title={recolhido ? 'Backoffice' : undefined}
                className={`text-warning hover:bg-warning/10 mb-1 flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors ${
                  recolhido ? 'md:justify-center md:px-0' : ''
                }`}
              >
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <span className={`truncate ${recolhido ? 'md:hidden' : ''}`}>
                  Backoffice
                  <span className="text-text-faint ml-1 text-[10px] uppercase">
                    {sessaoAdmin.papel}
                  </span>
                </span>
              </Link>
            )}

            {/* Minimizar é uma escolha de DESKTOP: no celular o menu é gaveta,
                e uma trilha de 64 px permanente ali comeria a tela inteira. */}
            <button
              onClick={alternarMenu}
              className={`text-text-muted hover:bg-panel-hover hover:text-text hidden w-full items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors md:flex ${
                recolhido ? 'md:justify-center md:px-0' : ''
              }`}
              title={recolhido ? 'Expandir menu' : 'Minimizar menu'}
              aria-label={recolhido ? 'Expandir menu' : 'Minimizar menu'}
            >
              {recolhido ? (
                <PanelLeft className="h-5 w-5 shrink-0" />
              ) : (
                <PanelLeftClose className="h-5 w-5 shrink-0" />
              )}
              <span className={recolhido ? 'md:hidden' : ''}>Minimizar</span>
            </button>

            <button
              onClick={handleLogout}
              className={`text-danger hover:bg-danger/10 flex w-full items-center gap-3 rounded-md px-4 py-3 font-medium transition-colors ${
                recolhido ? 'md:justify-center md:px-0' : ''
              }`}
              title="Sair da Mesa"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              <span className={recolhido ? 'md:hidden' : ''}>Sair da Mesa</span>
            </button>
          </div>
        </aside>

        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        <main className="relative mt-16 min-w-0 flex-1 overflow-y-auto md:mt-0">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="relative z-10 p-3 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
