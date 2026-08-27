import React from 'react';
import { API_URL } from '@/lib/api';
import { User, Trophy, Calendar, Ghost } from 'lucide-react';
import Link from 'next/link';

async function getProfile(username: string) {
  try {
    const res = await fetch(`${API_URL}/users/${username}`, { next: { revalidate: 60 } });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error('Falha ao carregar perfil');
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-table-dark">
        <div className="text-center">
          <Ghost className="w-16 h-16 text-text-muted mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-text mb-2">Planeswalker não encontrado</h1>
          <p className="text-text-muted mb-6">O perfil /u/{username} não existe ou foi removido.</p>
          <Link href="/" className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover">
            Voltar para o Início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-table-dark py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Cabeçalho do Perfil */}
        <div className="bg-panel border border-panel-border rounded-2xl p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-r from-primary/20 to-speaking/20" />
          
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 mt-8">
            <div className="w-32 h-32 rounded-full bg-table-deep border-4 border-panel shadow-lg overflow-hidden flex items-center justify-center flex-shrink-0">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.displayName || profile.username} className="w-full h-full object-cover" />
              ) : (
                <User className="w-16 h-16 text-text-muted" />
              )}
            </div>
            
            <div className="text-center md:text-left flex-1">
              <h1 className="text-3xl font-bold text-white mb-1">
                {profile.displayName || profile.username}
              </h1>
              <p className="text-primary font-mono bg-primary/10 inline-block px-3 py-1 rounded-full">
                @{profile.username}
              </p>
              
              {profile.role === 'ADMIN' && (
                <span className="ml-3 text-xs bg-danger/20 text-danger border border-danger/30 px-2 py-0.5 rounded font-bold uppercase">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Estatísticas e Informações */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-panel border border-panel-border rounded-xl p-6 shadow-lg flex items-center gap-4 hover:border-primary/50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-muted">Partidas Jogadas</p>
              <p className="text-3xl font-bold text-white">{profile._count?.participions || 0}</p>
            </div>
          </div>

          <div className="bg-panel border border-panel-border rounded-xl p-6 shadow-lg flex items-center gap-4 hover:border-speaking/50 transition-colors">
            <div className="w-12 h-12 rounded-full bg-speaking/20 flex items-center justify-center text-speaking">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-muted">No AetherTable desde</p>
              <p className="text-xl font-bold text-white">
                {new Date(profile.createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
