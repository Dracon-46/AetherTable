'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { API_URL } from '@/lib/api';
import { apelidoParaEnvio, type PerfilDaConta, type PerfilSalvo } from '@/lib/perfil';
import { mensagemDoCorpoDeErro } from '@/lib/fetcher';
import { User, Save, Loader2, Trophy, Clock } from 'lucide-react';
import Link from 'next/link';

export default function ProfilePage() {
  const { accessToken, setAuth, user: sessionUser } = useAuthStore();
  const [profile, setProfile] = useState<PerfilDaConta | null>(null);
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
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = (await res.json()) as PerfilDaConta;
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
    // A falha já é tratada (e registrada) dentro de `fetchProfile`.
    void fetchProfile();
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
          Authorization: `Bearer ${accessToken}`,
        },
        // Ver `apelidoParaEnvio`: o apelido em branco ia como `''` e o servidor
        // recusava o formulário inteiro, inclusive a troca de nome de usuário.
        body: JSON.stringify({
          username,
          displayName: apelidoParaEnvio(displayName, profile?.displayName),
        }),
      });

      if (res.ok) {
        const updatedUser = (await res.json()) as PerfilSalvo;
        setProfile((p) => ({ ...p, ...updatedUser }));
        setMessage({ text: 'Perfil atualizado com sucesso!', type: 'success' });

        // Atualiza a sessão
        if (sessionUser && accessToken) {
          setAuth(accessToken, {
            ...sessionUser,
            username: updatedUser.username,
            displayName: updatedUser.displayName ?? null,
            avatarUrl: updatedUser.avatarUrl || '',
          });
        }
      } else {
        const err: unknown = await res.json();
        // `err.message` de um 400 de validação é sempre "Dados inválidos.";
        // o campo e o motivo vêm em `erros[]`. Ver `mensagemDoCorpoDeErro`.
        setMessage({
          text: mensagemDoCorpoDeErro(err) ?? 'Erro ao atualizar perfil.',
          type: 'error',
        });
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
      <div className="text-primary flex h-[50vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-text mb-2 text-3xl font-bold">Meu Perfil</h1>
        <p className="text-text-muted">
          Gerencie suas informações públicas e credenciais da conta.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {/* Painel Esquerdo: Formulário */}
        <div className="space-y-6 md:col-span-2">
          <form
            onSubmit={handleSave}
            className="bg-panel border-panel-border rounded-xl border p-6 shadow-lg"
          >
            <h2 className="text-text mb-6 flex items-center gap-2 text-xl font-bold">
              <User className="text-primary h-5 w-5" /> Dados Públicos
            </h2>

            {message.text && (
              <div
                className={`mb-6 rounded-md p-4 text-sm ${message.type === 'success' ? 'bg-success/10 text-success border-success/30 border' : 'bg-danger/10 text-danger border-danger/30 border'}`}
              >
                {message.text}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-text-muted mb-1 block text-sm font-medium">
                  Nome de Usuário (Username)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-2 transition-colors focus:outline-none"
                  placeholder="Seu identificador único (@)"
                  required
                />
                <p className="text-text-faint mt-1 text-xs">
                  Usado para te encontrarem. Ex: /u/{username || 'username'}
                </p>
              </div>

              <div>
                <label className="text-text-muted mb-1 block text-sm font-medium">
                  Apelido na Mesa (Display Name)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-2 transition-colors focus:outline-none"
                  placeholder="Como você será visto durante o jogo"
                />
              </div>

              <div>
                <label className="text-text-muted mb-1 block text-sm font-medium">E-mail</label>
                <input
                  type="email"
                  value={profile?.email || ''}
                  disabled
                  className="bg-table-deep/50 border-panel-border text-text-muted w-full cursor-not-allowed rounded-md border px-4 py-2 opacity-60"
                />
                <p className="text-text-faint mt-1 text-xs">
                  O e-mail não pode ser alterado e nunca é exibido publicamente.
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-lg px-6 py-2 font-medium text-white transition-colors disabled:opacity-50"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>

        {/* Painel Direito: Estatísticas */}
        <div className="space-y-6">
          <div className="bg-panel border-panel-border rounded-xl border p-6 shadow-lg">
            <h2 className="text-text mb-4 text-lg font-bold">Estatísticas</h2>

            <div className="space-y-4">
              <div className="bg-table-deep border-panel-border flex items-center gap-4 rounded-lg border p-4">
                <div className="bg-primary/20 text-primary rounded-full p-3">
                  <Trophy className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-text-muted text-sm">Partidas Jogadas</p>
                  <p className="text-text text-2xl font-bold">
                    {profile?._count?.participions ?? 0}
                  </p>
                </div>
              </div>

              <div className="bg-table-deep border-panel-border flex items-center gap-4 rounded-lg border p-4">
                <div className="bg-speaking/20 text-speaking rounded-full p-3">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-text-muted text-sm">Conta Criada em</p>
                  <p className="text-text text-sm font-bold">
                    {profile?.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString('pt-BR')
                      : '---'}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-panel-border mt-6 border-t pt-6 text-center">
              <Link
                href={`/u/${profile?.username}`}
                className="text-primary flex items-center justify-center gap-2 text-sm hover:underline"
              >
                <User className="h-4 w-4" /> Ver meu perfil público
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
