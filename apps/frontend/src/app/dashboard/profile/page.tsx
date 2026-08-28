'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { API_URL } from '@/lib/api';
import { User, Save, Loader2, Trophy, Clock, History } from 'lucide-react';
import Link from 'next/link';

export default function ProfilePage() {
  const { accessToken, setAuth, user: sessionUser } = useAuthStore();
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  useEffect(() => {
    async function fetchProfile() {
      if (!accessToken) return;
      try {
        const res = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
          setDisplayName(data.displayName || '');
          setUsername(data.username || '');
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchProfile();
  }, [accessToken]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ displayName, username })
      });

      if (res.ok) {
        const updatedUser = await res.json();
        setProfile((p: any) => ({ ...p, ...updatedUser }));
        setMessage({ text: 'Perfil atualizado com sucesso!', type: 'success' });
        
        // Atualiza a sessão
        if (sessionUser && accessToken) {
          setAuth(accessToken, { ...sessionUser, username: updatedUser.username, avatarUrl: updatedUser.avatarUrl || '' });
        }
      } else {
        const err = await res.json();
        setMessage({ text: err.message || 'Erro ao atualizar perfil.', type: 'error' });
      }
    } catch (err) {
      console.error(err);
      setMessage({ text: 'Falha na conexão.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center text-primary">
        <Loader2 className="w-10 h-10 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-text mb-2">Meu Perfil</h1>
        <p className="text-text-muted">Gerencie suas informações públicas e credenciais da conta.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Painel Esquerdo: Formulário */}
        <div className="md:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-panel border border-panel-border p-6 rounded-xl shadow-lg">
            <h2 className="text-xl font-bold text-text mb-6 flex items-center gap-2">
              <User className="w-5 h-5 text-primary" /> Dados Públicos
            </h2>

            {message.text && (
              <div className={`p-4 rounded-md mb-6 text-sm ${message.type === 'success' ? 'bg-success/10 text-success border border-success/30' : 'bg-danger/10 text-danger border border-danger/30'}`}>
                {message.text}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Nome de Usuário (Username)</label>
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-table-deep border border-panel-border rounded-md px-4 py-2 text-text focus:outline-none focus:border-primary transition-colors"
                  placeholder="Seu identificador único (@)"
                  required
                />
                <p className="text-xs text-text-faint mt-1">Usado para te encontrarem. Ex: /u/{username || 'username'}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Apelido na Mesa (Display Name)</label>
                <input 
                  type="text" 
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-table-deep border border-panel-border rounded-md px-4 py-2 text-text focus:outline-none focus:border-primary transition-colors"
                  placeholder="Como você será visto durante o jogo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">E-mail</label>
                <input 
                  type="email" 
                  value={profile?.email || ''}
                  disabled
                  className="w-full bg-table-deep/50 border border-panel-border rounded-md px-4 py-2 text-text-muted opacity-60 cursor-not-allowed"
                />
                <p className="text-xs text-text-faint mt-1">O e-mail não pode ser alterado e nunca é exibido publicamente.</p>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button 
                type="submit" 
                disabled={isSaving}
                className="bg-primary hover:bg-primary-hover text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>

        {/* Painel Direito: Estatísticas */}
        <div className="space-y-6">
          <div className="bg-panel border border-panel-border p-6 rounded-xl shadow-lg">
            <h2 className="text-lg font-bold text-text mb-4">Estatísticas</h2>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4 bg-table-deep p-4 rounded-lg border border-panel-border">
                <div className="p-3 bg-primary/20 rounded-full text-primary">
                  <Trophy className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-text-muted">Partidas Jogadas</p>
                  <p className="text-2xl font-bold text-text">{profile?._count?.participions || 0}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 bg-table-deep p-4 rounded-lg border border-panel-border">
                <div className="p-3 bg-speaking/20 rounded-full text-speaking">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-text-muted">Conta Criada em</p>
                  <p className="text-sm font-bold text-text">
                    {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString('pt-BR') : '---'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-panel-border text-center">
              <Link 
                href={`/u/${profile?.username}`}
                className="text-sm text-primary hover:underline flex items-center justify-center gap-2"
              >
                <User className="w-4 h-4" /> Ver meu perfil público
              </Link>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
