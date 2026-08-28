'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { API_URL } from '@/lib/api';
import { Settings, Save, Check } from 'lucide-react';

export default function SettingsPage() {
  const { user, accessToken } = useAuthStore();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
      setDisplayName((user as any).displayName || '');
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ username, displayName, language }),
      });
      
      const data = await res.json();
      if (res.ok) {
        setMessage('Perfil atualizado com sucesso! (Saia e entre novamente para ver o efeito global no cabeçalho)');
      } else {
        setMessage(`Erro: ${data.message || 'Falha ao salvar'}`);
      }
    } catch (err) {
      setMessage('Erro na conexão com o servidor.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2 flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary" />
          Ajustes do Sistema
        </h1>
        <p className="text-text-muted">Configure sua identidade e preferências na Taverna.</p>
      </header>

      <section className="bg-panel border border-panel-border p-6 rounded-xl shadow-lg mb-8">
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-text-muted mb-2 uppercase">Nome de Usuário (Login único)</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-table-deep border border-panel-border rounded-md px-4 py-3 text-text focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-muted mb-2 uppercase">Nome de Exibição na Mesa (Opcional)</label>
            <input 
              type="text" 
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Ex: Arthur (O Terrível)"
              className="w-full bg-table-deep border border-panel-border rounded-md px-4 py-3 text-text focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-muted mb-2 uppercase">Idioma Principal</label>
            <select 
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full bg-table-deep border border-panel-border rounded-md px-4 py-3 text-text focus:outline-none focus:border-primary transition-colors"
            >
              <option value="pt-BR">Português (Brasil)</option>
              <option value="en-US">English (US)</option>
              <option value="es-ES">Español</option>
            </select>
          </div>

          {message && (
            <div className={`p-4 rounded-md text-sm font-medium flex items-center gap-2 ${message.includes('Erro') ? 'bg-danger/10 text-danger border border-danger/30' : 'bg-success/10 text-success border border-success/30'}`}>
              {message.includes('Erro') ? null : <Check className="w-4 h-4" />}
              {message}
            </div>
          )}

          <div className="pt-4 border-t border-panel-border flex justify-end">
            <button 
              type="submit" 
              disabled={isSaving}
              className="px-6 py-3 bg-primary text-white font-bold rounded-md shadow-md hover:bg-primary-hover transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {isSaving ? 'Salvando...' : 'Salvar Preferências'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
