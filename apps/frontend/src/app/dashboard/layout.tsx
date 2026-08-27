'use client';

import { LogOut, LayoutDashboard, Layers, Settings, User, Home, LibraryBig } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useAuthStore } from '../../store/auth.store';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, setAuth, logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Captura token do redirecionamento OAuth
    const token = searchParams.get('token');
    if (token) {
      // Idealmente a API deve fornecer `/users/me` para pegar o user dado o token
      // Para o MVP OAuth (Dummy), podemos recarregar os dados se tiver o token
      fetch('http://localhost:3333/api/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(userData => {
          if (userData && !userData.statusCode) {
            setAuth(token, userData);
            // Limpa a URL
            router.replace('/dashboard');
          }
        })
        .catch(err => console.error(err));
    }
  }, [searchParams, setAuth, router]);

  // Close mobile menu when pathname changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen w-full bg-table-deep text-text overflow-hidden font-sans">
        
        {/* Mobile Header with Hamburger */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-panel-border bg-panel z-30 absolute top-0 w-full">
          <div className="font-bold text-lg text-text">AetherTable</div>
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="text-text p-2 hover:bg-panel-hover rounded-md transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="md:hidden fixed inset-0 bg-black/50 z-20 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          fixed md:relative top-0 left-0 h-full w-64 bg-panel border-r border-panel-border flex flex-col justify-between shadow-2xl z-30
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          pt-16 md:pt-0
        `}>
          <div>
            <div className="p-6 border-b border-panel-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold shadow-md">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm truncate w-32">{user?.username || 'Planeswalker'}</span>
                <span className="text-xs text-success flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                  Conectado
                </span>
              </div>
            </div>

            <nav className="p-4 space-y-2 mt-4">
              <Link 
                href="/dashboard"
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/dashboard' ? 'bg-primary/20 text-primary' : 'text-text hover:bg-panel-hover'
                }`}
              >
                <Home className="w-5 h-5" />
                <span className="font-medium">Início</span>
              </Link>
              <Link 
                href="/dashboard/decks"
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  pathname.startsWith('/dashboard/decks') ? 'bg-primary/20 text-primary' : 'text-text hover:bg-panel-hover'
                }`}
              >
                <LibraryBig className="w-5 h-5" />
                <span className="font-medium">Meus Grimórios</span>
              </Link>
              <Link 
                href="/dashboard/profile"
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/dashboard/profile' ? 'bg-primary/20 text-primary' : 'text-text hover:bg-panel-hover'
                }`}
              >
                <User className="w-5 h-5" />
                <span className="font-medium">Meu Perfil</span>
              </Link>
              <Link 
                href="/dashboard/settings"
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  pathname === '/dashboard/settings' ? 'bg-primary/20 text-primary' : 'text-text hover:bg-panel-hover'
                }`}
              >
                <Settings className="w-5 h-5" />
                <span className="font-medium">Ajustes</span>
              </Link>
            </nav>
          </div>

          <div className="p-4 border-t border-panel-border">
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-danger hover:bg-danger/10 transition-colors font-medium"
            >
              <LogOut className="w-5 h-5" />
              Sair da Mesa
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 relative overflow-y-auto mt-16 md:mt-0">
          {/* Subtle background texture for the lobby */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
               style={{ backgroundImage: 'radial-gradient(circle at center, #ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }} 
          />
          <div className="relative z-10 p-8">
            {children}
          </div>
        </main>
        
      </div>
    </ProtectedRoute>
  );
}
