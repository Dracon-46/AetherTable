/**
 * novidades.ts — o que mudou em cada versão, para quem joga.
 *
 * As mensagens das tags (`git tag -n`) são escritas para quem mantém o código:
 * explicam o defeito, a causa e a escolha. Isto é o mesmo conteúdo dito para
 * quem joga — o que dá para fazer agora que antes não dava.
 *
 * A primeira entrada é a mais recente; o sino compara a versão dela com a
 * última que a pessoa viu.
 */

export interface Novidade {
  versao: string;
  /** AAAA-MM-DD. */
  data: string;
  titulo: string;
  itens: string[];
}

export const NOVIDADES: readonly Novidade[] = [
  {
    versao: '0.9.0',
    data: '2026-10-14',
    titulo: 'Histórico, draft, desafios e decks prontos',
    itens: [
      'Histórico: cada partida fica registrada com quem jogou, com que deck e comandante, quem venceu e quanto durou. Filtros por resultado e formato, e o resumo pode ser copiado.',
      'Decks iniciais oficiais: doze decks pré-montados da Wizards, prontos para jogar ou copiar para a sua conta — também na sala de espera.',
      'Deck aleatório: o sistema sorteia um comandante e monta um deck de 100 cartas em volta dele (36 terrenos, ramp, compra, remoção e o tema do comandante).',
      'Sugestões no editor: cartas que combinam com o seu comandante, por papel, sem repetir o que o deck já tem.',
      'No editor, a quantidade pode ser digitada e o nome da carta pode ser copiado.',
      'Sino de notificações: curtidas e comentários nos seus decks públicos, e denúncias analisadas.',
      'Comentários nos decks públicos — o dono lê e apaga os da casa dele.',
      'Pastas para organizar a lista de decks.',
      'Idioma das cartas: ponha o deck inteiro em português (ou outro idioma) num clique; o seletor de arte mostra as impressões nesse idioma.',
      'Draft contra sete robôs e Selado, em coleções recentes; o deck de 40 vai para a conta e para a mesa.',
      'Desafios: adivinhe a carta, escada de dicas, grade de criaturas, mais jogada e mais cara.',
      'Placa de nome: um novo cosmético para o seu nome na mesa.',
      'Na mesa: seta saindo da mão, log em outra janela ou dividido entre chat e ações, e prazo opcional para o mulligan.',
      'Interface em inglês (menus e as telas principais; o resto segue em português por enquanto).',
      'Corrigido: "para o fundo do grimório" e a devolução do London mulligan davam erro.',
      'Excluir a conta agora apaga a conta e os dados dela na hora.',
    ],
  },
  {
    versao: '0.8.0',
    data: '2026-10-14',
    titulo: 'A mesa ganha pilha, olhadas e fichas',
    itens: [
      '"Olhar X do topo/fundo" mostra as cartas num painel, com reordenação e ação por carta.',
      'Pilha: conjurar pela pilha, copiar mágica e resolver.',
      'Reações (teclas 7–0), rastreador de mana (M), dados de 2 a 1000 lados e foco de jogador (1–6).',
      'Fichas por quantidade, personalizadas, recentes e do deck inteiro.',
      'Decks: favorito, clonar, testar numa mesa solo, exportar, descrição e reserva.',
      'Explorar: decks públicos com curtidas e "copiar para os meus decks".',
    ],
  },
  {
    versao: '0.7.1',
    data: '2026-09-21',
    titulo: 'Política de privacidade',
    itens: [
      'A política de privacidade e o aviso de Fan Content ficam no rodapé da entrada — e o login com Google passa a valer para todo mundo.',
    ],
  },
  {
    versao: '0.7.0',
    data: '2026-09-21',
    titulo: 'Esqueci a senha e login com Google',
    itens: [
      '"Esqueceu a senha?" manda um link por e-mail, válido por 30 minutos e uma vez só.',
      'Entrar com Google.',
    ],
  },
  {
    versao: '0.6.0',
    data: '2026-09-16',
    titulo: 'A mesa aguenta uma partida longa',
    itens: [
      'Recarregar a página (F5) volta para a mesa: o assento fica guardado por 10 minutos.',
      'O scry grava a ordem que você escolheu.',
      'A mesa não fica mais lenta com o passar das horas.',
    ],
  },
];

export const NOVIDADE_MAIS_RECENTE = NOVIDADES[0]!;
