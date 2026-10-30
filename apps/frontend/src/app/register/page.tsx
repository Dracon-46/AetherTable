'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, UserPlus, AlertCircle } from 'lucide-react';
import {
  AVISO_ALERTA,
  AVISO_ERRO,
  BOTAO_PRIMARIO,
  CAMPO,
  CabecalhoDoCartao,
  LINK,
  PortaFalkyria,
  ROTULO,
} from '../PortaFalkyria';
import type { HumorDoDragao } from '../../components/DragaoAether';
import { useAuthStore, type SessaoDaApi } from '../../store/auth.store';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { mensagemDoCorpoDeErro } from '@/lib/fetcher';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';
import { useLangDoDocumento, useT } from '../../i18n/i18n';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Estado do cold start. O módulo `net/wake.ts` existia desde sempre, com
   * documentação e tudo — e NENHUM arquivo o importava. No plano gratuito o
   * serviço hiberna após ~15 min e a primeira requisição fica pendurada ~50 s:
   * sem este aviso, o usuário clica, nada acontece, e ele clica de novo.
   */
  const [estadoServidor, setEstadoServidor] = useState<EstadoAcordar | null>(null);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** O dragão olha o formulário — ver o `humor` do login. */
  const [campoEmFoco, setCampoEmFoco] = useState<'texto' | 'senha' | null>(null);
  const t = useT();
  useLangDoDocumento();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    setError(null);

    try {
      const acordou = await acordarApi(setEstadoServidor);
      if (!acordou) {
        setError(MENSAGEM_POR_ESTADO.falhou);
        setIsRegistering(false);
        setEstadoServidor(null);
        return;
      }

      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });

      const data = (await response.json()) as SessaoDaApi;

      if (!response.ok) {
        // `data.message` de um 400 de validação é só "Dados inválidos." — a
        // regra que falhou (senha curta, caractere proibido no nome) vem em
        // `erros[]`. Ver `mensagemDoCorpoDeErro`.
        throw new Error(mensagemDoCorpoDeErro(data) ?? 'Falha ao registrar');
      }

      // Registro bem-sucedido! A API já retorna o token automaticamente
      // (sem precisar de um segundo fetch para login)
      setAuth(data.accessToken, data.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : null);
      setIsRegistering(false);
    } finally {
      setEstadoServidor(null);
    }
  };

  const humor: HumorDoDragao = isRegistering
    ? 'invocando'
    : error
      ? 'alerta'
      : campoEmFoco === 'senha'
        ? 'olhos-fechados'
        : campoEmFoco
          ? 'atento'
          : 'repouso';

  const focar = (campo: 'texto' | 'senha') => ({
    onFocus: () => setCampoEmFoco(campo),
    onBlur: () => setCampoEmFoco(null),
  });

  return (
    <PortaFalkyria
      chamada={t('Junte-se à mesa e forje seu destino.')}
      humor={humor}
      tremer={!!error}
    >
      <CabecalhoDoCartao
        icone={<UserPlus size={17} aria-hidden="true" />}
        titulo={t('Alistar-se')}
        subtitulo={t('Junte-se à mesa e forje seu destino.')}
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-5">
        {estadoServidor === 'acordando' && (
          <div className={AVISO_ALERTA}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{t(MENSAGEM_POR_ESTADO.acordando)}</p>
          </div>
        )}

        {error && (
          <div role="alert" className={AVISO_ERRO}>
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{t(error)}</p>
          </div>
        )}
      </div>

      <form onSubmit={handleRegister} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="cadastro-nome" className={ROTULO}>
            {t('Nome de Usuário')}
          </label>
          <input
            id="cadastro-nome"
            type="text"
            autoComplete="username"
            required
            disabled={isRegistering}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            {...focar('texto')}
            className={CAMPO}
            placeholder="Jace Beleren"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="cadastro-email" className={ROTULO}>
            {t('E-mail')}
          </label>
          <input
            id="cadastro-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            disabled={isRegistering}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...focar('texto')}
            className={CAMPO}
            placeholder={t('seuemail@exemplo.com')}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="cadastro-senha" className={ROTULO}>
            {t('Senha (Criptografada)')}
          </label>
          <input
            id="cadastro-senha"
            type="password"
            autoComplete="new-password"
            required
            disabled={isRegistering}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...focar('senha')}
            className={CAMPO}
            placeholder="••••••••••••"
          />
        </div>

        <button type="submit" disabled={isRegistering} className={`${BOTAO_PRIMARIO} mt-1`}>
          {isRegistering ? (
            t('Criando Perfil...')
          ) : (
            <>
              {t('Criar Conta Grátis')}
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="ease-out-expo transition-transform duration-300 group-hover:translate-x-1"
              />
            </>
          )}
        </button>
      </form>

      <div className="border-line mt-6 border-t pt-5 text-center">
        <p className="text-muted text-sm">
          {t('Já tem uma conta?')}{' '}
          <Link href="/" className={`${LINK} font-medium`}>
            {t('Voltar ao Login')}
          </Link>
        </p>
      </div>
    </PortaFalkyria>
  );
}
