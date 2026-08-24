'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isAuthenticated()) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  // Evita flash de conteúdo não autorizado no SSR/Hydration
  if (!mounted || !isAuthenticated()) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-table-deep text-text">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium tracking-wider">VERIFICANDO RUNAS...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
