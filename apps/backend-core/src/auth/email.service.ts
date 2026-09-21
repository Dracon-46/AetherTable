/**
 * email.service.ts — o único lugar que manda e-mail neste projeto.
 *
 * ─── POR QUE NÃO É SMTP, E NÃO É NODEMAILER ────────────────────────────────
 *
 * A escolha óbvia seria `nodemailer` apontando para um SMTP. Ela foi descartada
 * por um motivo concreto do alvo de deploy documentado em
 * `docs/deploy_gratuito.md`: **o plano gratuito do Render bloqueia tráfego de
 * saída nas portas 25, 465 e 587**. Um serviço gratuito não consegue abrir
 * conexão SMTP nenhuma, e o sintoma é o pior possível — funciona na máquina do
 * desenvolvedor, e em produção o `sendMail` fica pendurado até o timeout
 * enquanto a tela diz "se o e-mail existir, enviamos um link".
 *
 * API HTTP resolve isso por sair na 443, que nenhum plano bloqueia. E, como
 * consequência, não entra dependência nova: o Node 22 (exigido no `engines` da
 * raiz) já tem `fetch` global. Uma biblioteca de e-mail inteira para fazer um
 * POST JSON seria peso sem contrapartida.
 *
 * ─── TROCAR DE PROVEDOR É MEXER EM UMA FUNÇÃO ──────────────────────────────
 *
 * `enviarPorHttp` fala o formato da Resend. Mailgun, Postmark, Brevo e SendGrid
 * têm todos o mesmo desenho (POST com chave no cabeçalho), então a troca é o
 * corpo dessa função e mais nada — nenhum outro arquivo do projeto sabe quem
 * entrega o e-mail.
 *
 * ─── SEM CHAVE: DEV IMPRIME, PRODUÇÃO RECUSA ───────────────────────────────
 *
 * Sem `RESEND_API_KEY`, em desenvolvimento o link vai para o log do servidor —
 * é o que permite testar a recuperação inteira sem contratar nada. Em produção
 * a chamada FALHA, com erro explícito. A alternativa (responder "enviamos" sem
 * ter enviado) é exatamente o tipo de tela que mente que este repositório trata
 * como defeito: o usuário esperaria um e-mail que nunca sai, e ninguém saberia.
 */

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  private get chave(): string | undefined {
    return this.config.get<string>('RESEND_API_KEY')?.trim() || undefined;
  }

  private get remetente(): string {
    // O domínio precisa estar verificado no provedor. `onboarding@resend.dev`
    // é o remetente de teste da Resend e só entrega para o e-mail dono da
    // conta — serve para o primeiro teste e não serve para produção.
    return this.config.get<string>('MAIL_FROM')?.trim() || 'AetherTable <onboarding@resend.dev>';
  }

  /** `true` quando há como entregar e-mail de verdade neste ambiente. */
  get configurado(): boolean {
    return Boolean(this.chave);
  }

  private get emProducao(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  async enviar(msg: Mensagem): Promise<void> {
    if (!this.configurado) {
      if (this.emProducao) {
        throw new ServiceUnavailableException(
          'O envio de e-mail não está configurado neste servidor. Avise um administrador.',
        );
      }

      /**
       * O log é o "provedor de e-mail" do ambiente local.
       *
       * Vai em `warn` e não em `debug` de propósito: em nível de log apertado,
       * um `debug` sumiria e o desenvolvedor concluiria que a rota está
       * quebrada, quando ela fez exatamente o que devia.
       */
      this.logger.warn(
        `RESEND_API_KEY ausente — e-mail NÃO enviado. Conteúdo abaixo (só em desenvolvimento).\n` +
          `Para: ${msg.para}\nAssunto: ${msg.assunto}\n\n${msg.texto}`,
      );
      return;
    }

    await this.enviarPorHttp(msg);
  }

  private async enviarPorHttp(msg: Mensagem): Promise<void> {
    /**
     * Timeout explícito.
     *
     * `fetch` do Node não tem um por padrão: uma API de e-mail fora do ar
     * deixaria a requisição HTTP do usuário pendurada indefinidamente, e o
     * throttler da rota garantiria que ele não pudesse nem tentar de novo.
     * Dez segundos é muito mais do que um POST de e-mail leva e muito menos do
     * que a paciência de quem está olhando a tela.
     */
    const corte = AbortSignal.timeout(10_000);

    let resposta: Response;
    try {
      resposta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.chave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.remetente,
          to: [msg.para],
          subject: msg.assunto,
          text: msg.texto,
          html: msg.html,
        }),
        signal: corte,
      });
    } catch (erro) {
      // O endereço do destinatário NÃO entra no log de erro: ele é dado
      // pessoal, e este caminho é alcançável por qualquer um digitando um
      // e-mail alheio na tela de recuperação.
      this.logger.error(`Falha de rede ao enviar e-mail: ${String(erro)}`);
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.',
      );
    }

    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => '');
      this.logger.error(
        `Provedor de e-mail respondeu ${resposta.status}: ${detalhe.slice(0, 500)}`,
      );
      throw new ServiceUnavailableException(
        'Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.',
      );
    }
  }
}
