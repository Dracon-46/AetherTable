'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/auth.store';
import { API_URL } from '@/lib/api';
import { Settings, Save, Check, Palette, User as UserIcon, Sun, Moon, Monitor } from 'lucide-react';
import { DESCRICAO_DO_TEMA, TEMAS } from '@aethertable/shared-types';
import { useTema } from '../../../store/tema.store';
import { CosmeticPicker } from '../../../components/CosmeticPicker';

export default function SettingsPage() {
  const tema = useTema((t) => t.tema);
  const escolherTema = useTema((t) => t.escolher);

  const { user, accessToken } = useAuthStore();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState('pt-BR');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [aba, setAba] = useState<'perfil' | 'cosmeticos'>('perfil');

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
        setMessage(
          'Perfil atualizado com sucesso! (Saia e entre novamente para ver o efeito global no cabeçalho)',
        );
      } else {
        setMessage(`Erro: ${data.message || 'Falha ao salvar'}`);
      }
    } catch {
      setMessage('Erro na conexão com o servidor.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl animate-[fadeIn_0.3s_ease-out]">
      <header className="mb-8">
        <h1 className="text-text mb-2 flex items-center gap-3 text-3xl font-bold">
          <Settings className="text-primary h-8 w-8" />
          Ajustes do Sistema
        </h1>
        <p className="text-text-muted">Configure sua identidade e preferências na Taverna.</p>

        {/* Abas: os cosméticos são uma seção inteira, não um campo a mais no
            formulário de perfil. */}
        <nav className="border-panel-border mt-6 flex gap-1 border-b">
          {(
            [
              ['perfil', 'Perfil', <UserIcon key="u" className="h-4 w-4" />],
              ['cosmeticos', 'Cosméticos', <Palette key="p" className="h-4 w-4" />],
            ] as const
          ).map(([id, rotulo, icone]) => (
            <button
              key={id}
              onClick={() => setAba(id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                aba === id
                  ? 'border-primary text-primary'
                  : 'text-text-muted hover:text-text border-transparent'
              }`}
            >
              {icone}
              {rotulo}
            </button>
          ))}
        </nav>
      </header>

      {aba === 'cosmeticos' && (
        <div className="painel-entra">
          <CosmeticPicker />
        </div>
      )}

      {aba === 'perfil' && (
        <>
          <section className="bg-panel border-panel-border mb-8 rounded-xl border p-6 shadow-lg">
            <form onSubmit={handleSave} className="space-y-6">
              <div>
                <label className="text-text-muted mb-2 block text-sm font-bold uppercase">
                  Nome de Usuário (Login único)
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 transition-colors focus:outline-none"
                />
              </div>

              <div>
                <label className="text-text-muted mb-2 block text-sm font-bold uppercase">
                  Nome de Exibição na Mesa (Opcional)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex: Arthur (O Terrível)"
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 transition-colors focus:outline-none"
                />
              </div>

              {/* ─── ESTILO DE TELA ─────────────────────────────────────
                  `UserPreference.theme` existia no banco desde a primeira
                  migracao, com enum de tres valores, e NENHUMA tela o
                  oferecia — nem rota o aceitava. A coluna prometia troca de
                  tema e o produto nunca teve.

                  Botao e nao `<select>`: sao tres opcoes, cada uma com uma
                  consequencia que merece uma frase, e o efeito e IMEDIATO —
                  um select esconderia duas das tres atras de um clique e nao
                  teria onde explicar o que cada uma faz. */}
              <div>
                <label className="text-text-muted mb-2 block text-sm font-bold uppercase">
                  Estilo de tela
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {TEMAS.map((t) => {
                    const d = DESCRICAO_DO_TEMA[t];
                    const Icone = t === 'CLARO' ? Sun : t === 'ESCURO' ? Moon : Monitor;
                    const ativo = tema === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => escolherTema(t)}
                        aria-pressed={ativo}
                        className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors ${
                          ativo
                            ? 'border-primary bg-primary/10'
                            : 'border-panel-border bg-table-deep hover:border-panel-hover'
                        }`}
                      >
                        <span className="text-text flex items-center gap-2 text-sm font-bold">
                          <Icone className="h-4 w-4" />
                          {d.nome}
                        </span>
                        <span className="text-text-faint text-xs">{d.resumo}</span>
                      </button>
                    );
                  })}
                </div>
                {/* A mesa nao muda, e dizer isso evita a leitura de que o
                    tema claro "nao funcionou" ao entrar numa partida. */}
                <p className="text-text-faint mt-1.5 text-xs">
                  A mesa de jogo continua escura nos tres: fundo escuro e o que faz a arte da carta
                  aparecer.
                </p>
              </div>

              <div>
                <label className="text-text-muted mb-2 block text-sm font-bold uppercase">
                  Idioma Principal
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border px-4 py-3 transition-colors focus:outline-none"
                >
                  <option value="pt-BR">Português (Brasil)</option>
                  <option value="en-US">English (US)</option>
                  <option value="es-ES">Español</option>
                </select>
              </div>

              {message && (
                <div
                  className={`flex items-center gap-2 rounded-md p-4 text-sm font-medium ${message.includes('Erro') ? 'bg-danger/10 text-danger border-danger/30 border' : 'bg-success/10 text-success border-success/30 border'}`}
                >
                  {message.includes('Erro') ? null : <Check className="h-4 w-4" />}
                  {message}
                </div>
              )}

              <div className="border-panel-border flex justify-end border-t pt-4">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="bg-primary hover:bg-primary-hover flex items-center gap-2 rounded-md px-6 py-3 font-bold text-white shadow-md transition-all disabled:opacity-50"
                >
                  <Save className="h-5 w-5" />
                  {isSaving ? 'Salvando...' : 'Salvar Preferências'}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
