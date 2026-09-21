/**
 * recuperacao.service.ts — "Esqueceu?" passa a levar a algum lugar.
 *
 * ─── O QUE EXISTIA ─────────────────────────────────────────────────────────
 *
 * `<a href="#">Esqueceu?</a>` na tela de login (`app/page.tsx`), registrado na
 * auditoria de paridade (DOC-094 §I.8) como "não há recuperação de senha". Quem
 * esquecia a senha perdia a conta — ou pedia a um administrador, que gerava uma
 * senha temporária no backoffice e a entregava por fora, colocando uma
 * credencial em trânsito por WhatsApp ou Discord.
 *
 * ─── A RESPOSTA É SEMPRE A MESMA, E É POR ISSO QUE ELA SERVE ───────────────
 *
 * `solicitar` não diz se o e-mail existe. Nunca. É o mesmo princípio que faz o
 * login responder "credenciais inválidas" sem distinguir e-mail errado de senha
 * errada (DOC-050, DOC-060 §"Enumeração de contas"): uma rota pública que
 * confirma a existência de um e-mail é um verificador de cadastro à disposição
 * de qualquer um — útil para phishing dirigido e para cruzar vazamentos de
 * outras plataformas.
 *
 * Por isso NENHUM caminho aqui devolve erro diferente: conta inexistente, conta
 * banida, conta suspensa e conta de OAuth terminam todas no mesmo `202`.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.js';
import { urlDoFrontend } from './url-do-frontend.js';
import {
  CAMINHO_DE_REDEFINICAO,
  VALIDADE_EM_MINUTOS,
  expiracaoAPartirDe,
  gerarTokenDeRedefinicao,
  hashDoToken,
  tokenUtilizavel,
} from './token-de-redefinicao.js';

/**
 * O erro que a redefinição devolve, traduzido no controller.
 *
 * Um tipo próprio em vez de `BadRequestException` direto porque a distinção
 * entre "token não existe", "token já foi usado" e "token venceu" importa para
 * o LOG e não pode importar para a RESPOSTA — as três viram a mesma frase na
 * tela, e sem isso a mensagem de erro contaria a um atacante se ele acertou um
 * token válido e apenas chegou tarde.
 */
export class TokenDeRedefinicaoInvalido extends Error {
  constructor(readonly motivoInterno: string) {
    super('Este link de redefinição não vale mais. Peça um novo.');
    this.name = 'TokenDeRedefinicaoInvalido';
  }
}

@Injectable()
export class RecuperacaoService {
  private readonly logger = new Logger(RecuperacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Gera o link e o envia — quando há para quem enviar.
   *
   * Devolve `void` de propósito: quem chama não tem o que decidir a partir
   * daqui, e um booleano de "encontrei a conta" seria o vazamento que o resto
   * do método evita.
   */
  async solicitar(email: string): Promise<void> {
    const usuario = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, email: true, username: true, passwordHash: true },
    });

    // Conta inexistente ou banida: nada acontece, e a resposta é idêntica à do
    // caminho de sucesso. Sair daqui em silêncio É o comportamento.
    if (!usuario) return;

    /**
     * Conta de OAuth recebe outro e-mail, e isso não é vazamento.
     *
     * A mensagem vai para a caixa de entrada do DONO do endereço — quem já
     * sabe, por definição, o que tem naquela conta. O que seria vazamento é
     * dizer isso na TELA, para quem digitou o e-mail; ali a resposta continua
     * sendo a mesma para todos.
     *
     * Sem este ramo, o dono de uma conta só-Google pediria a redefinição,
     * receberia um link, escolheria uma senha nova e — como o login por senha
     * dessa conta nunca existiu — acharia que o sistema está quebrado. Pior:
     * criar uma senha para uma conta de OAuth a partir de um e-mail é abrir um
     * segundo caminho de entrada que o dono não pediu.
     */
    if (!usuario.passwordHash) {
      await this.enviarComSeguranca(() => this.avisarContaDeOAuth(usuario.email, usuario.username));
      return;
    }

    /**
     * Os pedidos anteriores morrem aqui.
     *
     * Sem esta linha, cada clique em "enviar link" deixaria mais um token vivo
     * por 30 minutos, e a caixa de entrada viraria uma coleção de chaves
     * válidas da mesma conta. Um só por vez: o último pedido é o que a pessoa
     * está olhando.
     */
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: usuario.id } });

    const token = gerarTokenDeRedefinicao();
    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash: hashDoToken(token),
        userId: usuario.id,
        expiresAt: expiracaoAPartirDe(),
      },
    });

    const link = `${urlDoFrontend(this.config)}${CAMINHO_DE_REDEFINICAO}?token=${encodeURIComponent(token)}`;
    await this.enviarComSeguranca(() => this.enviarLink(usuario.email, usuario.username, link));

    await this.expurgarVencidos();
  }

  /**
   * Redefine a senha a partir do token do e-mail.
   *
   * Devolve o `username` só para o log da rota; a resposta ao cliente é `204`.
   */
  async redefinir(token: string, novaSenha: string): Promise<void> {
    const linha = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashDoToken(token) },
      select: { tokenHash: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (!linha) throw new TokenDeRedefinicaoInvalido('token inexistente');
    if (!tokenUtilizavel(linha)) {
      throw new TokenDeRedefinicaoInvalido(linha.usedAt ? 'token já usado' : 'token vencido');
    }

    /**
     * A conta pode ter sido banida DEPOIS do pedido.
     *
     * Trinta minutos é tempo de sobra para um administrador banir alguém entre
     * o pedido e o clique. Sem esta checagem, o link seria o caminho de volta
     * para dentro de uma conta encerrada.
     */
    const usuario = await this.prisma.user.findFirst({
      where: { id: linha.userId, deletedAt: null },
      select: { id: true },
    });
    if (!usuario) throw new TokenDeRedefinicaoInvalido('conta encerrada após o pedido');

    const hash = await argon2.hash(novaSenha, { type: argon2.argon2id });

    /**
     * ─── OS TRÊS EFEITOS SÃO UMA TRANSAÇÃO SÓ ────────────────────────────
     *
     * Trocar a senha, marcar o token como usado e cortar as sessões precisam
     * acontecer juntos ou não acontecer. Fora de transação, uma falha entre o
     * primeiro e o segundo deixaria a senha nova gravada COM o token ainda
     * válido — um link de uso único que virou de uso ilimitado, exatamente no
     * cenário em que alguém já está mexendo na conta.
     *
     * `tokensValidosApos` derruba TODAS as sessões (ver `revogacao.service.ts`
     * e a coluna no schema). Aqui isso não é opcional: a razão número um para
     * alguém redefinir a senha é ter perdido o controle da conta, e uma
     * redefinição que deixa a sessão do invasor de pé não redefine nada.
     */
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: linha.userId },
        data: { passwordHash: hash, tokensValidosApos: new Date() },
      }),
      this.prisma.passwordResetToken.update({
        where: { tokenHash: linha.tokenHash },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.expurgarVencidos();
  }

  /**
   * Falha de entrega NÃO vira erro na resposta — e a alternativa é pior.
   *
   * O caminho óbvio seria propagar o erro do provedor. Ele foi descartado
   * porque reabre a enumeração pela porta dos fundos: e-mail inexistente sai
   * daqui com `202`, e e-mail existente com o provedor fora do ar sairia com
   * `503`. A diferença entre as duas respostas é a resposta à pergunta que esta
   * rota inteira existe para não responder.
   *
   * Configuração AUSENTE é outro caso e continua estourando: ela vale igual
   * para todos os e-mails (não distingue conta nenhuma) e precisa ser barulhenta
   * — é o `EmailService` que decide isso, e em produção ele recusa.
   */
  private async enviarComSeguranca(envio: () => Promise<void>): Promise<void> {
    try {
      await envio();
    } catch (erro) {
      this.logger.error(`Falha ao entregar e-mail de recuperação de senha: ${String(erro)}`);
    }
  }

  private async enviarLink(para: string, username: string, link: string): Promise<void> {
    const assunto = 'Redefinir sua senha no AetherTable';
    const texto = [
      `Olá, ${username}.`,
      '',
      'Alguém pediu para redefinir a senha da sua conta no AetherTable.',
      'Abra o link abaixo para escolher uma senha nova:',
      '',
      link,
      '',
      `O link vale por ${VALIDADE_EM_MINUTOS} minutos e só pode ser usado uma vez.`,
      '',
      'Se não foi você, ignore este e-mail. Nada muda na sua conta enquanto o',
      'link não for aberto — e sua senha atual continua valendo.',
    ].join('\n');

    await this.email.enviar({ para, assunto, texto, html: this.html(username, link) });
  }

  private async avisarContaDeOAuth(para: string, username: string): Promise<void> {
    const texto = [
      `Olá, ${username}.`,
      '',
      'Alguém pediu para redefinir a senha da sua conta no AetherTable — mas ela',
      'não tem senha: você entra pelo Google ou pelo Discord.',
      '',
      'Use o botão do seu provedor na tela de entrada e você estará dentro.',
      '',
      'Se não foi você quem pediu, ignore este e-mail. Nada mudou na sua conta.',
    ].join('\n');

    await this.email.enviar({
      para,
      assunto: 'Sua conta do AetherTable entra por Google ou Discord',
      texto,
      // Sem link para clicar: um e-mail que a pessoa não pediu e que leva a
      // algum lugar é o formato do phishing que ela deveria aprender a ignorar.
      html: `<p>Olá, ${this.escapar(username)}.</p>
<p>Alguém pediu para redefinir a senha da sua conta no AetherTable — mas ela não tem senha:
você entra pelo <strong>Google</strong> ou pelo <strong>Discord</strong>.</p>
<p>Use o botão do seu provedor na tela de entrada e você estará dentro.</p>
<p style="color:#777;font-size:13px">Se não foi você quem pediu, ignore este e-mail. Nada mudou na sua conta.</p>`,
    });
  }

  private html(username: string, link: string): string {
    const seguro = this.escapar(link);
    return `<p>Olá, ${this.escapar(username)}.</p>
<p>Alguém pediu para redefinir a senha da sua conta no AetherTable.</p>
<p><a href="${seguro}" style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold">Escolher uma senha nova</a></p>
<p style="color:#777;font-size:13px">Ou copie este endereço: <br>${seguro}</p>
<p style="color:#777;font-size:13px">O link vale por ${VALIDADE_EM_MINUTOS} minutos e só pode ser usado uma vez.</p>
<p style="color:#777;font-size:13px">Se não foi você, ignore este e-mail. Sua senha atual continua valendo.</p>`;
  }

  /**
   * O `username` é escolhido pelo usuário e vai dentro de um HTML que outra
   * pessoa lê. Sem escape, `<img onerror=...>` num nome de usuário viraria
   * conteúdo ativo na caixa de entrada de terceiros.
   */
  private escapar(texto: string): string {
    return texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Limpeza oportunista, pelo mesmo motivo de `RevogacaoService`: não há
   * scheduler neste projeto. Roda no pedido e na redefinição, que é quando uma
   * linha nova entra. Falhar aqui não pode derrubar a operação que a pessoa
   * pediu.
   */
  private async expurgarVencidos(): Promise<void> {
    try {
      await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch (erro) {
      this.logger.warn(`Falha ao expurgar tokens de redefinição vencidos: ${String(erro)}`);
    }
  }
}
