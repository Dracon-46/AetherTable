'use client';

/**
 * /senha/esqueci — pedir o link de redefinição.
 *
 * ─── O DESTINO QUE O "ESQUECEU?" NÃO TINHA ─────────────────────────────────
 *
 * O link da tela de login era `<a href="#">`, registrado na auditoria de
 * paridade (DOC-094 §I.8) como "não há recuperação de senha".
 *
 * ─── A TELA CONFIRMA SEM CONFIRMAR NADA ────────────────────────────────────
 *
 * A mensagem de sucesso diz "se houver uma conta com este e-mail". O
 * condicional não é delicadeza de redação: o servidor responde `202` para
 * e-mail inexistente, banido, suspenso e de OAuth, todos iguais, justamente
 * para que esta rota pública não vire um verificador de cadastro. Escrever
 * "enviamos para você" aqui desfaria no texto a proteção que o backend construiu
 * na resposta.
 */

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Loader2, Mail, AlertCircle, Check } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { acordarApi, MENSAGEM_POR_ESTADO, type EstadoAcordar } from '@/net/wake';
import { BOTAO, ENTRADA, Moldura } from '../Moldura';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  /**
   * Cold start. Esta é a primeira requisição de quem chega direto neste
   * endereço pelo e-mail ou por um marcador: no plano gratuito o container
   * hiberna em ~15 min e a chamada fica pendurada ~50 s. Sem o aviso, a pessoa
   * clica, nada acontece, e ela clica de novo — que é o comportamento que o
   * limite de 3 por minuto desta rota vai recusar.
   */
  const [estadoServidor, setEstadoServidor] = useState<EstadoAcordar | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setErro(null);

    try {
      const acordou = await acordarApi(setEstadoServidor);
      if (!acordou) {
        setErro(MENSAGEM_POR_ESTADO.falhou);
        return;
      }

      // `publica`: não há sessão aqui — quem esqueceu a senha não está dentro.
      await api('/auth/senha/esqueci', { method: 'POST', body: { email }, publica: true });
      setEnviado(true);
    } catch (erroDaApi) {
      setErro(mensagemDaApi(erroDaApi));
    } finally {
      setEnviando(false);
      setEstadoServidor(null);
    }
  }

  if (enviado) {
    return (
      <Moldura
        icone={<Mail className="text-success h-[17px] w-[17px]" />}
        titulo="Confira seu e-mail"
        subtitulo="O corvo já partiu."
      >
        <div className="bg-success/10 text-success flex items-start gap-3 rounded-xl px-4 py-3 text-sm">
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Se houver uma conta com <strong>{email}</strong>, o link de redefinição chegará em
            instantes. Ele vale por 30 minutos e só pode ser usado uma vez.
          </p>
        </div>

        <p className="text-muted mt-4 text-xs leading-relaxed">
          Não chegou? Veja a caixa de spam. Se a sua conta entra pelo Google ou pelo Discord, ela
          não tem senha — o e-mail que você recebeu explica isso, e o botão do provedor na tela de
          entrada resolve.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura
      icone={<KeyRound className="text-accent h-[17px] w-[17px]" />}
      titulo="Esqueceu a senha?"
      subtitulo="Informe seu e-mail e enviaremos um link para escolher outra."
      tremer={Boolean(erro)}
    >
      {estadoServidor === 'acordando' && (
        <div className="bg-amber-soft text-amber-ink mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{MENSAGEM_POR_ESTADO.acordando}</p>
        </div>
      )}

      {erro && (
        <div className="bg-danger-soft text-danger mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] leading-relaxed">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{erro}</p>
        </div>
      )}

      <form onSubmit={enviar} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-muted block text-xs font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            disabled={enviando}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={ENTRADA}
            placeholder="seuemail@exemplo.com"
          />
        </div>

        <button type="submit" disabled={enviando || email.trim().length === 0} className={BOTAO}>
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          {enviando
            ? estadoServidor === 'acordando'
              ? 'Acordando o servidor…'
              : 'Enviando…'
            : 'Enviar link de redefinição'}
        </button>
      </form>

      <p className="text-muted mt-4 text-center text-sm">
        Lembrou?{' '}
        <Link
          href="/"
          className="text-accent hover:text-accent-hover font-medium transition-colors"
        >
          Entrar
        </Link>
      </p>
    </Moldura>
  );
}
