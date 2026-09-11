'use client';

/**
 * tema.store.ts — claro, escuro ou o que o sistema mandar.
 *
 * ─── A COLUNA EXISTIA E NINGUÉM A LIA ──────────────────────────────────────
 *
 * `UserPreference.theme` está no Prisma desde a PRIMEIRA migração, com
 * `@default(DARK)` e um enum de três valores. Nenhuma rota a aceitava, nenhum
 * componente a lia, e não havia seletor em lugar nenhum. O esquema prometia
 * troca de tema e o produto nunca teve — é uma das quatro colunas mortas que a
 * auditoria listou, junto de `voiceMode`, `pttKey` e `masterVolume`.
 *
 * ─── COMO O TEMA CHEGA NA TELA ─────────────────────────────────────────────
 *
 * Um atributo `data-tema` no `<html>`, e o CSS troca os TOKENS de cor
 * (`globals.css`). Nenhum componente muda: `bg-panel` continua sendo
 * `bg-panel`, e o que troca é o valor por trás. Um componente novo herda os
 * dois temas de graça — que é a razão de não ter sido feito com `dark:` do
 * Tailwind, que exigiria tocar centenas de classes e deixaria todo componente
 * futuro quebrado em um dos dois temas sem erro de compilação.
 *
 * ─── `SISTEMA` PRECISA CONTINUAR OUVINDO ───────────────────────────────────
 *
 * Não basta ler `prefers-color-scheme` uma vez na carga. Quem deixa o sistema
 * operacional trocar de tema ao anoitecer espera que a aba aberta acompanhe —
 * e uma aba que só muda depois de um F5 é indistinguível de uma que não
 * funciona. Por isso há um listener, e ele só existe enquanto o modo é
 * `SISTEMA`.
 */

import { create } from 'zustand';
import { TEMA_PADRAO, type Tema } from '@aethertable/shared-types';
import { api } from '../lib/fetcher';

const CHAVE = 'aethertable:tema';

/** O que de fato vai para o `data-tema`: `SISTEMA` já resolvido. */
type TemaEfetivo = 'claro' | 'escuro';

function preferenciaDoSistema(): TemaEfetivo {
  if (typeof window === 'undefined') return 'escuro';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro';
}

function resolver(tema: Tema): TemaEfetivo {
  if (tema === 'SISTEMA') return preferenciaDoSistema();
  return tema === 'CLARO' ? 'claro' : 'escuro';
}

/**
 * Escreve no `<html>`.
 *
 * `data-tema="escuro"` é escrito explicitamente em vez de removido: o CSS
 * define o escuro no `:root` sem seletor, então remover o atributo daria o
 * mesmo resultado — mas deixaria impossível distinguir "escuro escolhido" de
 * "tema ainda não aplicado" ao inspecionar a página.
 */
function aplicarNoDocumento(efetivo: TemaEfetivo): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.tema = efetivo;
}

function lerLocal(): Tema {
  if (typeof window === 'undefined') return TEMA_PADRAO;
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    return bruto === 'CLARO' || bruto === 'ESCURO' || bruto === 'SISTEMA' ? bruto : TEMA_PADRAO;
  } catch {
    return TEMA_PADRAO;
  }
}

interface TemaState {
  tema: Tema;
  /** O que está desenhado agora — `SISTEMA` já resolvido. */
  efetivo: TemaEfetivo;
  /** Escolha do usuário: aplica, guarda local e manda para a conta. */
  escolher: (tema: Tema) => void;
  /** Vem do `GET /users/me`. NÃO reenvia — ver `useHidratarPreferencias`. */
  aplicarDoServidor: (tema: Tema) => void;
}

/** Cancela o listener anterior de `prefers-color-scheme`, se houver. */
let pararDeOuvirOSistema: (() => void) | null = null;

function ouvirOSistema(aoMudar: (efetivo: TemaEfetivo) => void): void {
  pararDeOuvirOSistema?.();
  pararDeOuvirOSistema = null;
  if (typeof window === 'undefined') return;

  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = (e: MediaQueryListEvent) => aoMudar(e.matches ? 'claro' : 'escuro');
  mq.addEventListener('change', handler);
  pararDeOuvirOSistema = () => mq.removeEventListener('change', handler);
}

export const useTema = create<TemaState>((set, get) => ({
  tema: TEMA_PADRAO,
  efetivo: 'escuro',

  escolher: (tema) => {
    const efetivo = resolver(tema);
    set({ tema, efetivo });
    aplicarNoDocumento(efetivo);

    try {
      window.localStorage.setItem(CHAVE, tema);
    } catch {
      /* modo privado — a conta ainda guarda */
    }

    if (tema === 'SISTEMA') {
      ouvirOSistema((novo) => {
        // A escolha continua sendo `SISTEMA`; só o efetivo muda.
        if (get().tema === 'SISTEMA') {
          set({ efetivo: novo });
          aplicarNoDocumento(novo);
        }
      });
    } else {
      pararDeOuvirOSistema?.();
      pararDeOuvirOSistema = null;
    }

    /**
     * A falha é engolida de propósito: o tema já mudou na tela e está no
     * `localStorage`. Um toast de erro sobre preferência visual seria ruído
     * sobre algo que não impede nada — e a próxima sessão tenta de novo.
     */
    void api('/users/me', { method: 'PATCH', body: { tema } }).catch(() => undefined);
  },

  aplicarDoServidor: (tema) => {
    const efetivo = resolver(tema);
    set({ tema, efetivo });
    aplicarNoDocumento(efetivo);
    if (tema === 'SISTEMA') {
      ouvirOSistema((novo) => {
        if (get().tema === 'SISTEMA') {
          set({ efetivo: novo });
          aplicarNoDocumento(novo);
        }
      });
    }
  },
}));

/**
 * Aplica o que o navegador já sabe, ANTES de a conta responder.
 *
 * Sem isto, quem escolheu claro vê a tela escura por uma volta de rede a cada
 * carga — o "flash do tema errado". O `localStorage` é o caminho rápido e a
 * conta é a fonte da verdade entre dispositivos; é o mesmo desenho dos
 * cosméticos, pelo mesmo motivo.
 */
export function aplicarTemaLocal(): void {
  const tema = lerLocal();
  useTema.getState().aplicarDoServidor(tema);
}
