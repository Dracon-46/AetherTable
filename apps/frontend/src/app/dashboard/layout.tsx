'use client';

import { LogOut, Settings, User, Home, LibraryBig } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useAuthStore } from '../../store/auth.store';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { OAuthTokenCapture } from '../../components/OAuthTokenCapture';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Fecha o menu mobile ao trocar de rota
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <ProtectedRoute>
      <Suspense fallback={null}>
        <OAuthTokenCapture />
      </Suspense>
      <div className="bg-table-deep text-text flex h-dvh w-full overflow-hidden font-sans">
        {/* Mobile Header with Hamburger */}
        <div className="border-panel-border bg-panel absolute top-0 z-30 flex w-full items-center justify-between border-b p-4 md:hidden">
          <div className="text-text text-lg font-bold">AetherTable</div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-text hover:bg-panel-hover rounded-md p-2 transition-colors"
          >
            {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`bg-panel border-panel-border fixed left-0 top-0 z-30 flex h-full w-64 transform flex-col justify-between border-r shadow-2xl transition-transform duration-300 ease-in-out md:relative ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} pt-16 md:pt-0`}
        >
          <div>
            <div className="border-panel-border flex items-center gap-3 border-b p-6">
              <div className="bg-primary flex h-10 w-10 items-center justify-center rounded-full font-bold text-white shadow-md">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col">
                <span className="w-32 truncate text-sm font-semibold">
                  {user?.username || 'Planeswalker'}
                </span>
                <span className="text-success flex items-center gap-1 text-xs">
                  <div className="bg-success h-2 w-2 animate-pulse rounded-full" />
                  Conectado
                </span>
              </div>
            </div>

            <nav className="mt-4 space-y-2 p-4">
              <Link
                href="/dashboard"
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  pathname === '/dashboard'
                    ? 'bg-primary/20 text-primary'
                    : 'text-text hover:bg-panel-hover'
                }`}
              >
                <Home className="h-5 w-5" />
                <span className="font-medium">Início</span>
              </Link>
              <Link
                href="/dashboard/decks"
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  pathname.startsWith('/dashboard/decks')
                    ? 'bg-primary/20 text-primary'
                    : 'text-text hover:bg-panel-hover'
                }`}
              >
                <LibraryBig className="h-5 w-5" />
                <span className="font-medium">Meus Grimórios</span>
              </Link>
              <Link
                href="/dashboard/profile"
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  pathname === '/dashboard/profile'
                    ? 'bg-primary/20 text-primary'
                    : 'text-text hover:bg-panel-hover'
                }`}
              >
                <User className="h-5 w-5" />
                <span className="font-medium">Meu Perfil</span>
              </Link>
              <Link
                href="/dashboard/settings"
                className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-colors ${
                  pathname === '/dashboard/settings'
                    ? 'bg-primary/20 text-primary'
                    : 'text-text hover:bg-panel-hover'
                }`}
              >
                <Settings className="h-5 w-5" />
                <span className="font-medium">Ajustes</span>
              </Link>
            </nav>
          </div>

          <div className="border-panel-border border-t p-4">
            <button
              onClick={handleLogout}
              className="text-danger hover:bg-danger/10 flex w-full items-center gap-3 rounded-md px-4 py-3 font-medium transition-colors"
            >
              <LogOut className="h-5 w-5" />
              Sair da Mesa
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="relative mt-16 flex-1 overflow-y-auto md:mt-0">
          {/* Subtle background texture for the lobby */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="relative z-10 p-4 sm:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
