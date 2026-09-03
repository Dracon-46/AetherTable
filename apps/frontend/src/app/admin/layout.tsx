'use client';

/**
 * layout.tsx do /admin — a casca do backoffice (DOC-061 §1).
 *
 * ─── DUAS CAMADAS DE PORTA, E POR QUE AS DUAS SÃO NECESSÁRIAS ──────────────
 *
 * O checklist de segurança (§6) pede "proteção de rota via guardião no Backend
 * E no Next.js". Aqui:
 *
 *   - o BACKEND é a porta de verdade. `PapeisGuard` consulta o papel no banco
 *     a cada requisição e recusa com 403. Nada do painel funciona sem ele.
 *   - o FRONTEND é conveniência e não segurança. Ele esconde a navegação e
 *     redireciona quem não tem acesso, para um usuário comum que digitou /admin
 *     não encarar uma tela de erros. Mas o gate visual é decidido por uma
 *     chamada ao servidor (`GET /admin/eu`), nunca pelo `role` que o login
 *     guardou no `localStorage` — o token vale sete dias, e uma despromoção
 *     não teria efeito nenhum nesse período.
 *
 * O documento pede SSR nesta checagem ("nunca retornar o HTML do admin se o JWT
 * não constar role ADMIN|MOD"). Aqui a checagem é no cliente, e vale registrar
 * a razão: a sessão vive num JWT no `localStorage`, não num cookie, então o
 * servidor Next NÃO TEM como saber quem está pedindo a página — não há
 * credencial na requisição de navegação. O HTML da casca não contém dado de
 * ninguém (ele é o esqueleto e um spinner); todo dado vem de rotas guardadas.
 * Mover a checagem para o servidor exigiria sessão em cookie, que é uma mudança
 * de arquitetura de autenticação, não um detalhe desta tela.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import {
  ArrowLeft,
  ClipboardList,
  Flag,
  Gauge,
  Loader2,
  Palette,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react';
import ProtectedRoute from '../../components/ProtectedRoute';
import { useSouAdmin } from '../../admin/useAdmin';
import { SeloDePapel } from '../../admin/Componentes';

interface Aba {
  href: string;
  rotulo: string;
  Icone: typeof Users;
  /** `true` = só ADMIN. Moderador não vê (DOC-061 §6). */
  somenteAdmin?: boolean;
}

const ABAS: Aba[] = [
  { href: '/admin', rotulo: 'Visão geral', Icone: Gauge },
  { href: '/admin/usuarios', rotulo: 'Usuários', Icone: Users },
  { href: '/admin/denuncias', rotulo: 'Denúncias', Icone: Flag },
  { href: '/admin/cosmeticos', rotulo: 'Cosméticos', Icone: Palette, somenteAdmin: true },
  { href: '/admin/sistema', rotulo: 'Sistema', Icone: Wrench, somenteAdmin: true },
  { href: '/admin/auditoria', rotulo: 'Auditoria', Icone: ClipboardList },
];

/**
 * `ProtectedRoute` PRECISA envolver o gate de papel, não o contrário.
 *
 * `useSouAdmin` só dispara quando há token (`enabled: Boolean(token)`), e o
 * token vem da reidratação ASSÍNCRONA do `persist` do zustand — no primeiro
 * render ele é `null` mesmo para quem está logado. Uma query desabilitada fica
 * eternamente em `isPending` no react-query v5, então sem esperar a
 * reidratação o painel travaria no "Conferindo credenciais…" para sempre.
 *
 * É o mesmo bug que `ProtectedRoute` documenta e resolve para o dashboard —
 * ele existe exatamente para isto.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <CascaDoAdmin>{children}</CascaDoAdmin>
    </ProtectedRoute>
  );
}

function CascaDoAdmin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: sessao, isPending, isError } = useSouAdmin();

  // `null` = autenticado mas sem papel. Volta para a taverna em vez de mostrar
  // uma tela de 403 — a pessoa não fez nada errado, só digitou uma URL.
  useEffect(() => {
    if (!isPending && !sessao) router.replace('/dashboard');
  }, [isPending, sessao, router]);

  if (isPending) {
    return (
      <div className="bg-table-deep text-text flex min-h-dvh w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="text-primary h-8 w-8 animate-spin" />
          <p className="text-text-muted text-sm">Conferindo credenciais…</p>
        </div>
      </div>
    );
  }

  if (isError || !sessao) {
    return (
      <div className="bg-table-deep text-text flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldAlert className="text-danger h-10 w-10" />
        <p className="text-text-muted">Esta área é restrita.</p>
        <Link href="/dashboard" className="text-primary text-sm hover:underline">
          Voltar para a Taverna
        </Link>
      </div>
    );
  }

  const abasVisiveis = ABAS.filter((a) => !a.somenteAdmin || sessao.papel === 'ADMIN');

  return (
    <div className="bg-table-deep text-text min-h-dvh w-full font-sans">
      <header className="border-panel-border bg-panel/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-3 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="text-text-muted hover:text-primary flex shrink-0 items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Taverna
          </Link>
          <span className="bg-panel-border h-4 w-px shrink-0" />
          <h1 className="text-text flex min-w-0 items-center gap-2 text-base font-bold">
            <ShieldAlert className="text-danger h-5 w-5 shrink-0" />
            <span className="truncate">Backoffice</span>
          </h1>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
            <span className="text-text-muted hidden sm:inline">{sessao.username}</span>
            <SeloDePapel papel={sessao.papel} />
          </span>
        </div>

        {/* `overflow-x-auto`: seis abas com ícone e texto não cabem em 390px, e
            escondê-las num menu suspenso esconderia a navegação inteira do
            painel numa tela onde ela é a única forma de sair da aba atual. */}
        <nav className="custom-scrollbar mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 sm:px-6">
          {abasVisiveis.map((aba) => {
            // Casamento exato na raiz, prefixo nas outras: `/admin` casaria com
            // tudo por prefixo e as seis abas ficariam acesas ao mesmo tempo.
            const ativa =
              aba.href === '/admin' ? pathname === '/admin' : pathname.startsWith(aba.href);
            return (
              <Link
                key={aba.href}
                href={aba.href}
                aria-current={ativa ? 'page' : undefined}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  ativa
                    ? 'border-primary text-primary'
                    : 'text-text-muted hover:text-text border-transparent'
                }`}
              >
                <aba.Icone className="h-4 w-4 shrink-0" />
                {aba.rotulo}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl p-3 sm:p-6">{children}</main>
    </div>
  );
}
