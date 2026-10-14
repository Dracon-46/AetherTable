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
  // ─── Entrada ─────────────────────────────────────────────────────────────
  'Prepare suas defesas, o embate vai começar.':
    'Ready your defenses — the clash is about to begin.',
  'E-mail': 'Email',
  'seuemail@exemplo.com': 'you@example.com',
  Senha: 'Password',
  'Esqueceu?': 'Forgot?',
  'Acordando o servidor…': 'Waking the server…',
  'Invocando...': 'Summoning...',
  'Entrar no Saguão': 'Enter the Lobby',
  'ou continue com': 'or continue with',
  'Não tem uma conta?': "Don't have an account?",
  'Aliste-se': 'Sign up',
  'Política de Privacidade': 'Privacy Policy',
  'Projeto de fã, sem vínculo com a Wizards of the Coast':
    'Fan project, not affiliated with Wizards of the Coast',
  'Acordando o servidor — isso leva até 1 minuto na primeira vez...':
    'Waking the server — this can take up to a minute the first time...',
  'O servidor não respondeu. Tente novamente em instantes.':
    "The server didn't respond. Try again in a moment.",
  'Credenciais inválidas': 'Invalid credentials',
  'Este provedor não está disponível neste servidor. Entre com e-mail e senha.':
    'This provider is not available on this server. Sign in with email and password.',
  'O provedor não informou um e-mail utilizável. Verifique a privacidade do e-mail na conta dele e tente de novo.':
    "The provider didn't share a usable email. Check the email privacy settings on that account and try again.",
  'O provedor não confirmou que este e-mail é seu. Confirme o endereço na conta do provedor e tente de novo.':
    "The provider didn't confirm this email is yours. Verify the address on the provider account and try again.",
  'Este e-mail já pertence a uma conta do AetherTable. Entre com e-mail e senha.':
    'This email already belongs to an AetherTable account. Sign in with email and password.',
  'Você cancelou a autorização no provedor.': 'You cancelled the authorization on the provider.',
  'Não foi possível concluir o login pelo provedor. Tente de novo.':
    "Couldn't finish signing in with the provider. Try again.",
  // ─── Cadastro ────────────────────────────────────────────────────────────
  'Alistar-se': 'Sign up',
  'Junte-se à mesa e forje seu destino.': 'Join the table and forge your destiny.',
  'Nome de Usuário': 'Username',
  'Senha (Criptografada)': 'Password (encrypted)',
  'Criando Perfil...': 'Creating profile...',
  'Criar Conta Grátis': 'Create free account',
  'Voltar ao Login': 'Back to sign in',
  'Falha ao registrar': 'Sign-up failed',
};
