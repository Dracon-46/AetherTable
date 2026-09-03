'use client';

/**
 * Visão geral do backoffice.
 *
 * ─── O QUE ESTA TELA RESPONDE ──────────────────────────────────────────────
 *
 * "Preciso fazer algo agora?" — e é por isso que a fila de denúncias vem
 * primeiro, em destaque, com link direto. Um painel que abre num gráfico de
 * crescimento obriga o moderador a procurar o trabalho dele.
 *
 * Os números de plataforma vêm depois, e existem para dar contexto: "12
 * suspensos" significa coisas muito diferentes numa base de 40 e numa de 4.000.
 */

import Link from 'next/link';
import {
  AlertCircle,
  Flag,
  Gauge,
  Library,
  Loader2,
  ShieldCheck,
  Swords,
  UserCheck,
  UserMinus,
  Users,
  UserX,
} from 'lucide-react';
import { useVisaoGeral } from '../../admin/useAdmin';
import { Metrica } from '../../admin/Componentes';
import { mensagemDaApi } from '@/lib/fetcher';

export default function VisaoGeralPage() {
  const { data, isPending, isError, error } = useVisaoGeral();

  if (isPending) {
    return (
      <div className="text-text-muted flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Levantando os números…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="border-danger/30 bg-danger/10 text-danger flex items-center gap-3 rounded-xl border p-4">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <span className="text-sm">{mensagemDaApi(error)}</span>
      </div>
    );
  }

  const { usuarios, conteudo, partidas, moderacao, flags } = data;
  const desligadas = flags.filter((f) => !f.enabled);

  return (
    <div className="space-y-6">
      {/* ── O que exige ação ────────────────────────────────────────────── */}
      {moderacao.denunciasAbertas > 0 && (
        <Link
          href="/admin/denuncias"
          className="border-warning/40 bg-warning/10 hover:bg-warning/15 flex items-center gap-3 rounded-xl border p-4 transition-colors"
        >
          <Flag className="text-warning h-5 w-5 shrink-0" />
          <span className="text-warning min-w-0 flex-1 text-sm font-medium">
            {moderacao.denunciasAbertas}{' '}
            {moderacao.denunciasAbertas === 1 ? 'denúncia aberta' : 'denúncias abertas'} esperando
            análise.
          </span>
          <span className="text-warning shrink-0 text-xs font-bold uppercase">abrir fila →</span>
        </Link>
      )}

      {/* Um interruptor desligado é um estado ANORMAL da plataforma, e ele
          precisa estar visível na primeira tela: um kill switch acionado numa
          emergência e esquecido depois é indistinguível de um bug — "a voz não
          funciona para ninguém" sem nenhuma pista da causa. */}
      {desligadas.length > 0 && (
        <Link
          href="/admin/sistema"
          className="border-danger/40 bg-danger/10 hover:bg-danger/15 flex items-center gap-3 rounded-xl border p-4 transition-colors"
        >
          <AlertCircle className="text-danger h-5 w-5 shrink-0" />
          <span className="text-danger min-w-0 flex-1 text-sm font-medium">
            {desligadas.length} interruptor(es) desligado(s):{' '}
            {desligadas.map((f) => f.key).join(', ')}.
          </span>
          <span className="text-danger shrink-0 text-xs font-bold uppercase">ver →</span>
        </Link>
      )}

      {/* ── Contas ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <Users className="h-3.5 w-3.5" /> Contas
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Metrica rotulo="Total ativo" valor={usuarios.total} Icone={Users} />
          <Metrica
            rotulo="Ativos em 24h"
            valor={usuarios.ativosEm24h}
            detalhe={`${usuarios.novosNaSemana} novos na semana`}
            Icone={UserCheck}
            tom="sucesso"
          />
          <Metrica
            rotulo="Suspensos"
            valor={usuarios.suspensos}
            Icone={UserMinus}
            tom={usuarios.suspensos > 0 ? 'alerta' : 'neutro'}
          />
          <Metrica
            rotulo="Banidos"
            valor={usuarios.banidos}
            Icone={UserX}
            tom={usuarios.banidos > 0 ? 'perigo' : 'neutro'}
          />
        </div>
      </section>

      {/* ── Equipe ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <ShieldCheck className="h-3.5 w-3.5" /> Equipe
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metrica
            rotulo="Administradores"
            valor={usuarios.admins}
            Icone={ShieldCheck}
            // Um único admin é um ponto único de falha: perder o acesso dessa
            // conta significa recuperar a plataforma pelo banco. O painel diz
            // isso antes de acontecer, não depois.
            tom={usuarios.admins <= 1 ? 'alerta' : 'neutro'}
            detalhe={usuarios.admins <= 1 ? 'promova um segundo' : undefined}
          />
          <Metrica rotulo="Moderadores" valor={usuarios.moderadores} Icone={ShieldCheck} />
        </div>
      </section>

      {/* ── Plataforma ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-text-muted mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
          <Gauge className="h-3.5 w-3.5" /> Plataforma
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metrica rotulo="Grimórios" valor={conteudo.decks} Icone={Library} />
          <Metrica
            rotulo="Partidas"
            valor={partidas.total}
            detalhe={`${partidas.naSemana} na semana`}
            Icone={Swords}
          />
          <Metrica
            rotulo="Denúncias abertas"
            valor={moderacao.denunciasAbertas}
            Icone={Flag}
            tom={moderacao.denunciasAbertas > 0 ? 'alerta' : 'sucesso'}
          />
        </div>
        {/* A contagem de partidas vem de `MatchSummary`, que é deliberadamente
            pobre (RN12 / ADR-006): não guarda estado de jogo, jogadas, decks
            nem quem ganhou. Dizer isso aqui evita a pergunta seguinte. */}
        <p className="text-text-faint mt-3 text-xs">
          Partidas são contadas de forma agregada e anônima: o sistema não guarda estado de jogo,
          jogadas nem quem ganhou (RN12).
        </p>
      </section>
    </div>
  );
}
