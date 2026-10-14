/**
 * en.ts — a interface em inglês. A chave é o texto em português (ver i18n.ts).
 *
 * Cobertura: a casca do painel (menu, sino, sair), os Ajustes, e os títulos e
 * descrições das telas do painel. Texto sem entrada aqui aparece em português.
 */

export const EN: Readonly<Record<string, string>> = {
  // ─── Menu e casca ────────────────────────────────────────────────────────
  Início: 'Home',
  'Meus Grimórios': 'My Decks',
  Explorar: 'Explore',
  Histórico: 'History',
  Draft: 'Draft',
  Desafios: 'Challenges',
  'Meu Perfil': 'My Profile',
  Novidades: "What's new",
  Ajustes: 'Settings',
  Conectado: 'Online',
  Minimizar: 'Collapse',
  'Minimizar menu': 'Collapse menu',
  'Expandir menu': 'Expand menu',
  'Sair da Mesa': 'Sign out',
  'Abrir menu': 'Open menu',
  'Fechar menu': 'Close menu',
  'Navegação principal': 'Main navigation',
  Notificações: 'Notifications',
  'Notificações: {n} novas': 'Notifications: {n} new',
  Fechar: 'Close',
  'Nenhum aviso nos últimos 30 dias.': 'No notices in the last 30 days.',
  'Novidades da versão': 'New in version',
  'Ver o que mudou →': "See what's new →",

  // ─── Ajustes ─────────────────────────────────────────────────────────────
  'Idioma da interface': 'Interface language',
  'O idioma dos menus e das telas. O que ainda não foi traduzido aparece em português.':
    'The language of menus and screens. Anything not yet translated stays in Portuguese.',
  'Idioma das cartas': 'Card language',

  // ─── Títulos e descrições das telas ──────────────────────────────────────
  'As partidas que você jogou: quem estava na mesa, com que deck e quem venceu.':
    'The games you played: who was at the table, with which deck, and who won.',
  'O que mudou em cada versão.': 'What changed in each version.',
  'Passatempos com as cartas mais jogadas em Commander. O recorde fica neste navegador.':
    'Pastimes with the most played Commander cards. Your record stays in this browser.',
  'Abra pacotes de uma coleção, escolha carta a carta contra sete robôs (ou monte um selado) e leve o deck de 40 para a mesa.':
    'Open packs from a set, pick card by card against seven bots (or build a sealed pool) and take the 40-card deck to the table.',
  'Decks que outros jogadores deixaram públicos. Curta para guardar, copie para jogar.':
    'Decks other players made public. Like to save, copy to play.',
};
