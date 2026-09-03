import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AdminAction, Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * admin-bootstrap.service.ts — como a plataforma ganha o primeiro administrador.
 *
 * ─── O PROBLEMA DO OVO E DA GALINHA ────────────────────────────────────────
 *
 * Toda rota que promove alguém a `ADMIN` exige um `ADMIN` autenticado. Numa
 * base onde ninguém é admin — que é o estado de qualquer instalação nova, e era
 * o estado desta — o painel é inalcançável e a única saída é um `UPDATE` manual
 * no Postgres. Isso significa: cada ambiente novo (staging, a máquina de outro
 * desenvolvedor, um restore de backup) precisa de alguém com a string de
 * conexão do banco na mão.
 *
 * ─── A SOLUÇÃO: UMA VARIÁVEL DE AMBIENTE, RECONCILIADA NO BOOT ─────────────
 *
 * `ADMIN_EMAILS` lista os e-mails que DEVEM ser administradores. A cada boot, a
 * API reconcilia: quem está na lista e não é `ADMIN` é promovido, com uma linha
 * de auditoria explicando de onde veio a promoção.
 *
 * Três decisões dentro disso:
 *
 *  1. **ENV E NÃO CÓDIGO.** O e-mail do dono não é constante de produto: ele
 *     muda por ambiente, e escrevê-lo no fonte o publicaria em qualquer clone
 *     do repositório.
 *  2. **RECONCILIA, NÃO CRIA.** Se a conta não existe ainda, o serviço não a
 *     inventa — ele apenas registra que está esperando. Criar uma conta com
 *     senha a partir de env seria plantar uma credencial previsível; criar sem
 *     senha deixaria um e-mail administrativo reivindicável por qualquer um que
 *     se cadastrasse com ele. A promoção acontece no boot seguinte ao cadastro.
 *  3. **NUNCA DESPROMOVE.** Tirar um e-mail da lista não rebaixa ninguém. Se
 *     despromovesse, uma env var vazia num deploy mal configurado apagaria
 *     todos os administradores da plataforma de uma vez — e o caminho de volta
 *     seria justamente o acesso manual ao banco que este serviço existe para
 *     evitar. Rebaixar é ato deliberado, pelo painel, com justificativa e
 *     auditoria.
 */

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const emails = this.emailsConfigurados();
    if (emails.length === 0) {
      this.logger.warn(
        'ADMIN_EMAILS não configurado. Nenhuma conta será promovida a ADMIN automaticamente — ' +
          'o painel /admin fica inalcançável até alguém ser promovido.',
      );
      return;
    }

    try {
      await this.reconciliar(emails);
    } catch (erro) {
      /**
       * Um erro aqui NÃO derruba a API.
       *
       * O boot acontece antes de qualquer requisição, e o Neon do plano
       * gratuito autossuspende: a primeira conexão pode falhar por timeout.
       * Trocar "o admin não foi promovido neste boot" por "a API não subiu"
       * seria transformar um inconveniente numa indisponibilidade.
       */
      this.logger.error(`Falha ao reconciliar administradores: ${String(erro)}`);
    }
  }

  /** `ADMIN_EMAILS=a@x.com,b@y.com` — separados por vírgula ou ponto e vírgula. */
  private emailsConfigurados(): string[] {
    return (process.env['ADMIN_EMAILS'] ?? '')
      .split(/[,;]/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'));
  }

  private async reconciliar(emails: string[]): Promise<void> {
    const contas = await this.prisma.user.findMany({
      where: {
        // `mode: 'insensitive'` porque e-mail não diferencia caixa na prática e
        // a coluna é case-sensitive: "Arthur@..." no cadastro e "arthur@..." na
        // env resultariam em nenhuma promoção, sem erro nenhum.
        OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })),
      },
      select: { id: true, email: true, username: true, role: true, deletedAt: true },
    });

    const encontrados = new Set(contas.map((c) => c.email.toLowerCase()));
    for (const email of emails) {
      if (!encontrados.has(email)) {
        this.logger.warn(
          `ADMIN_EMAILS inclui "${email}", mas não existe conta com esse e-mail. ` +
            'Cadastre-se normalmente pelo site; a promoção acontece no próximo boot da API.',
        );
      }
    }

    for (const conta of contas) {
      if (conta.deletedAt) {
        this.logger.warn(
          `"${conta.email}" está em ADMIN_EMAILS mas a conta está banida. ` +
            'Restaure-a pelo painel antes de esperar acesso administrativo.',
        );
        continue;
      }
      if (conta.role === Role.ADMIN) continue;

      await this.prisma.user.update({ where: { id: conta.id }, data: { role: Role.ADMIN } });

      /**
       * A promoção é auditada como qualquer outra, com o autor "sistema".
       *
       * `actorId` é NULL porque não houve pessoa autenticada — e é exatamente
       * por isso que `actorLabel` existe como coluna própria: sem ela, a linha
       * mais sensível do log (quem virou admin, e como) seria a única sem
       * autor identificável.
       */
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorLabel: 'sistema (ADMIN_EMAILS)',
          action: AdminAction.USER_ROLE_CHANGE,
          targetType: 'user',
          targetId: conta.id,
          targetLabel: conta.username,
          reason: 'Promoção automática por ADMIN_EMAILS no boot da API.',
          metadata: { de: conta.role, para: Role.ADMIN, email: conta.email },
        },
      });

      this.logger.log(`${conta.username} <${conta.email}> promovido a ADMIN por ADMIN_EMAILS.`);
    }
  }
}
