/**
 * /privacidade — a política de privacidade.
 *
 * ─── POR QUE ELA EXISTE AGORA ──────────────────────────────────────────────
 *
 * DOC-094 §II.1 item 5 já dizia que termos, privacidade e o aviso de Fan
 * Content "não são opcionais se você publicar". O que forçou a data foi o
 * console do Google: publicar o app OAuth exige URL de página inicial E de
 * política de privacidade, e a tela de Branding recusa continuar sem as duas.
 *
 * ─── ELA DESCREVE O QUE O CÓDIGO FAZ, NÃO O QUE O PROJETO PRETENDE ─────────
 *
 * Duas divergências entre `docs/modelo_de_dados.md` §7 e a realidade foram
 * escritas aqui como a realidade, não como o documento:
 *
 *  1. NÃO HÁ EXPURGO AUTOMÁTICO EM 30 DIAS. O documento desenha um "job
 *     diário"; não existe scheduler nenhum no repositório (DOC-094 §I.8). A
 *     exclusão torna a conta inacessível na hora, e a remoção física é uma
 *     ação de administrador. Prometer o automático seria a pior versão de uma
 *     tela que mente: uma promessa legal que o sistema não cumpre.
 *  2. Os prazos de retenção do documento (12 meses, 24 meses, 6 meses)
 *     também dependem desse job. Aqui eles aparecem como o critério de quando
 *     apagamos sob pedido, que é o que de fato acontece.
 *
 * Renderizada estaticamente: sem `'use client'`, sem estado, sem fetch. Ela
 * precisa abrir para um revisor do Google e para quem não tem conta.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Política de Privacidade — AetherTable',
  description:
    'Quais dados o AetherTable coleta, por quê, com quem são compartilhados e como pedir a exclusão.',
};

/** Contato único para pedidos de privacidade. Ver o aviso no rodapé da página. */
const CONTATO = 'arthurgaspare@gmail.com';

/** Data da última revisão deste texto. Mude junto com o conteúdo. */
const ATUALIZADO_EM = '21 de setembro de 2026';

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-text mb-3 text-lg font-bold">{titulo}</h2>
      <div className="text-text-muted space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacidadePage() {
  return (
    <div className="min-h-dvh w-full px-4 py-10">
      <article className="bg-panel border-panel-border mx-auto w-full max-w-3xl rounded-lg border p-6 shadow-xl sm:p-10">
        <header className="border-panel-border mb-8 border-b pb-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-table-deep border-panel-border rounded-full border p-2.5 shadow-inner">
              <Shield className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-text text-2xl font-bold">Política de Privacidade</h1>
          </div>
          <p className="text-text-muted text-sm">
            AetherTable — última atualização em {ATUALIZADO_EM}.
          </p>
        </header>

        <Secao titulo="O que é o AetherTable">
          <p>
            O AetherTable é uma mesa virtual para jogar cartas com outras pessoas pela internet. É
            um <strong>sandbox</strong>: o sistema move as peças, sincroniza o estado da mesa e
            esconde a informação que precisa ficar escondida. Ele não aplica as regras do jogo —
            quem julga o que é legal na partida são os jogadores.
          </p>
          <p>
            É um projeto pessoal, sem fins comerciais e sem venda de cartas. Não é afiliado à
            Wizards of the Coast.
          </p>
        </Secao>

        <Secao titulo="Que dados coletamos">
          <p>Só o necessário para você ter uma conta e jogar:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>E-mail</strong> — identifica sua conta e é por onde enviamos o link de
              redefinição de senha, quando você pede.
            </li>
            <li>
              <strong>Nome de usuário e nome de exibição</strong> — aparecem publicamente na mesa e
              no seu perfil.
            </li>
            <li>
              <strong>Senha</strong> — guardada apenas como <em>hash</em> Argon2id. Ninguém, nem
              nós, consegue lê-la de volta.
            </li>
            <li>
              <strong>Avatar</strong> — o endereço da imagem, que pode vir do provedor de login.
            </li>
            <li>
              <strong>Vínculo com Google ou Discord</strong>, se você entrar por um deles —
              guardamos só o identificador da sua conta naquele serviço, para reconhecer você na
              próxima vez.
            </li>
            <li>
              <strong>Seus decks e suas preferências</strong> de mesa e aparência.
            </li>
            <li>
              <strong>Participação em partidas</strong> — quantos jogadores, quanto durou. Sem
              histórico de jogadas.
            </li>
            <li>
              <strong>Endereço IP</strong>, registrado apenas quando um administrador executa uma
              ação no painel de moderação, para investigar acesso indevido a conta administrativa.
            </li>
          </ul>
        </Secao>

        <Secao titulo="O que deliberadamente não guardamos">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Sua senha do Google ou do Discord — ela nunca passa por aqui.</li>
            <li>
              Os <em>tokens</em> desses provedores. Usamos o login apenas para saber quem você é,
              nunca para agir em seu nome.
            </li>
            <li>
              <strong>Conteúdo do chat da sala</strong> — ele existe só enquanto a partida existe.
            </li>
            <li>
              <strong>Áudio da conversa de voz</strong> — nunca é gravado.
            </li>
            <li>O que aconteceu dentro da partida, jogada a jogada.</li>
            <li>Dados de pagamento. Não processamos pagamento nenhum.</li>
          </ul>
        </Secao>

        <Secao titulo="Por que tratamos esses dados">
          <p>
            Para executar o serviço que você pediu ao criar a conta: autenticar você, guardar seus
            decks, colocar você numa mesa e manter a plataforma utilizável e segura. O registro de
            ações administrativas e de denúncias existe para moderação — sem ele, não há como apurar
            uma reclamação de conduta.
          </p>
        </Secao>

        <Secao titulo="Com quem os dados são compartilhados">
          <p>
            Não vendemos e não cedemos seus dados. Eles passam por estes serviços porque a
            plataforma roda neles:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Google e Discord</strong> — só se você escolher entrar por eles. Recebemos seu
              e-mail, nome e avatar.
            </li>
            <li>
              <strong>Resend</strong> — entrega os e-mails de redefinição de senha. Recebe seu
              endereço de e-mail e o conteúdo da mensagem.
            </li>
            <li>
              <strong>Neon, Render e Vercel</strong> — banco de dados, servidores e hospedagem do
              site.
            </li>
            <li>
              <strong>Scryfall</strong> — de onde vêm as imagens e os dados das cartas. As
              requisições saem do nosso servidor, não do seu navegador: a Scryfall não recebe seu
              endereço IP.
            </li>
          </ul>
          <p>Também podemos divulgar dados se formos obrigados por lei ou por ordem judicial.</p>
        </Secao>

        <Secao titulo="Por quanto tempo guardamos">
          <p>
            Sua conta e seus decks ficam enquanto a conta existir. Ao excluir a conta, ela se torna{' '}
            <strong>inacessível imediatamente</strong> e todas as suas sessões caem na hora.
          </p>
          <p>
            <strong>Sendo direto sobre uma limitação:</strong> a remoção física dos dados do banco
            hoje é feita manualmente por um administrador — não há um processo automático rodando
            todo dia. Se você quiser a remoção definitiva, peça pelo contato abaixo e ela será
            feita. Registros de moderação e de auditoria podem sobreviver de forma desvinculada da
            sua pessoa, porque um histórico que apaga a si mesmo não serve para apurar nada.
          </p>
        </Secao>

        <Secao titulo="Seus direitos">
          <p>
            Pela LGPD (Lei 13.709/2018), você pode pedir a qualquer momento: confirmação de que
            tratamos seus dados, acesso a eles, correção do que estiver errado, exclusão, e
            portabilidade. Nome de exibição, avatar e preferências você já altera sozinho em{' '}
            <span className="text-text">Ajustes</span>; a exclusão da conta também está lá.
          </p>
          <p>
            Para o resto, escreva para{' '}
            <a href={`mailto:${CONTATO}`} className="text-primary hover:text-primary-hover">
              {CONTATO}
            </a>
            . Respondemos do endereço cadastrado na conta, para não atender pedido de terceiro sobre
            dados que não são dele.
          </p>
        </Secao>

        <Secao titulo="Cookies e armazenamento no seu navegador">
          <p>
            <strong>
              Não usamos cookies de publicidade nem de rastreamento, e não há analytics de
              terceiros.
            </strong>{' '}
            O que existe é:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Armazenamento local</strong> — guarda seu token de sessão (para você não
              precisar entrar a cada carregamento), o tema escolhido e suas preferências de
              exibição. Fica no seu navegador.
            </li>
            <li>
              <strong>Um cookie temporário durante o login com Google ou Discord</strong>, que vive
              10 minutos e existe para impedir que outra pessoa forje esse login em seu nome.
            </li>
          </ul>
        </Secao>

        <Secao titulo="Menores de idade">
          <p>
            A plataforma não é destinada a menores de 13 anos. Se você é responsável por um menor
            que criou conta aqui, escreva para o contato acima e removemos.
          </p>
        </Secao>

        <Secao titulo="Conteúdo de terceiros">
          <p>
            O AetherTable não é produzido, endossado, apoiado nem afiliado à Wizards of the Coast
            LLC. Nomes, símbolos e imagens de cartas são propriedade de seus respectivos detentores.
            Este é um projeto de fã, sem fins lucrativos, sem venda de cartas, sem torneio e sem
            jogo ranqueado.
          </p>
          <p>
            Dados e imagens de cartas vêm da{' '}
            <a
              href="https://scryfall.com"
              className="text-primary hover:text-primary-hover"
              rel="noreferrer noopener"
              target="_blank"
            >
              Scryfall
            </a>
            . Se você detém direitos sobre algum conteúdo aqui e quer que ele saia, escreva para o
            contato acima.
          </p>
        </Secao>

        <Secao titulo="Mudanças nesta política">
          <p>
            Se ela mudar de forma relevante, a data no topo muda junto. Vale a pena reler antes de
            continuar usando a plataforma.
          </p>
        </Secao>

        <footer className="border-panel-border mt-10 border-t pt-6">
          <Link
            href="/"
            className="text-text-muted hover:text-primary inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a entrada
          </Link>
        </footer>
      </article>
    </div>
  );
}
