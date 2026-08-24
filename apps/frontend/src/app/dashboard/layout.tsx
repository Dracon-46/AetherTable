'use client';

import { LogOut, LayoutDashboard, Layers, Settings } from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useAuthStore } from '../../store/auth.store';
import { useRouter } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <ProtectedRoute>
      <div className="flex h-screen w-full bg-table-deep text-text overflow-hidden font-sans">
        
        {/* Sidebar */}
        <aside className="w-64 bg-panel border-r border-panel-border flex flex-col justify-between shadow-2xl relative z-20">
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
              <a href="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-md bg-table-deep border border-panel-border text-primary font-medium transition-colors">
                <LayoutDashboard className="w-5 h-5" />
                Saguão
              </a>
              <a href="/dashboard/decks" className="flex items-center gap-3 px-4 py-3 rounded-md text-text-muted hover:bg-panel-hover hover:text-text transition-colors group">
                <Layers className="w-5 h-5 group-hover:text-primary transition-colors" />
                Meus Decks
              </a>
              <a href="#" className="flex items-center gap-3 px-4 py-3 rounded-md text-text-muted hover:bg-panel-hover hover:text-text transition-colors group cursor-not-allowed">
                <Settings className="w-5 h-5 group-hover:text-primary transition-colors" />
                Ajustes
              </a>
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
        <main className="flex-1 relative overflow-y-auto">
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
