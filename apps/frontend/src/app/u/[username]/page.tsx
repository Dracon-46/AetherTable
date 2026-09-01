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

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfile(username);

  if (!profile) {
    return (
      <div className="bg-table-dark flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Ghost className="text-text-muted mx-auto mb-4 h-16 w-16" />
          <h1 className="text-text mb-2 text-2xl font-bold">Planeswalker não encontrado</h1>
          <p className="text-text-muted mb-6">O perfil /u/{username} não existe ou foi removido.</p>
          <Link
            href="/"
            className="bg-primary hover:bg-primary-hover rounded-lg px-6 py-2 text-white"
          >
            Voltar para o Início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-table-dark min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Cabeçalho do Perfil */}
        <div className="bg-panel border-panel-border relative overflow-hidden rounded-2xl border p-8 shadow-2xl">
          <div className="from-primary/20 to-speaking/20 absolute inset-x-0 top-0 h-24 bg-gradient-to-r" />

          <div className="relative z-10 mt-8 flex flex-col items-center gap-6 md:flex-row">
            <div className="bg-table-deep border-panel flex h-32 w-32 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-4 shadow-lg">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName || profile.username}
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="text-text-muted h-16 w-16" />
              )}
            </div>

            <div className="flex-1 text-center md:text-left">
              <h1 className="mb-1 text-3xl font-bold text-white">
                {profile.displayName || profile.username}
              </h1>
              <p className="text-primary bg-primary/10 inline-block rounded-full px-3 py-1 font-mono">
                @{profile.username}
              </p>

              {profile.role === 'ADMIN' && (
                <span className="bg-danger/20 text-danger border-danger/30 ml-3 rounded border px-2 py-0.5 text-xs font-bold uppercase">
                  Admin
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Estatísticas e Informações */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="bg-panel border-panel-border hover:border-primary/50 flex items-center gap-4 rounded-xl border p-6 shadow-lg transition-colors">
            <div className="bg-primary/20 text-primary flex h-12 w-12 items-center justify-center rounded-full">
              <Trophy className="h-6 w-6" />
            </div>
            <div>
              <p className="text-text-muted text-sm font-medium">Partidas Jogadas</p>
              <p className="text-3xl font-bold text-white">{profile._count?.participions || 0}</p>
            </div>
          </div>

          <div className="bg-panel border-panel-border hover:border-speaking/50 flex items-center gap-4 rounded-xl border p-6 shadow-lg transition-colors">
            <div className="bg-speaking/20 text-speaking flex h-12 w-12 items-center justify-center rounded-full">
              <Calendar className="h-6 w-6" />
            </div>
            <div>
              <p className="text-text-muted text-sm font-medium">No AetherTable desde</p>
              <p className="text-xl font-bold text-white">
                {new Date(profile.createdAt).toLocaleDateString('pt-BR', {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
