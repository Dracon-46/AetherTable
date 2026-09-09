import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * revogacao.service.ts — a denylist que faz o logout deslogar.
 *
 * ─── O QUE ESTAVA ACONTECENDO ───────────────────────────────────────────────
 *
 * `POST /auth/logout` era literalmente `return;`. Não revogava nada, e o
 * frontend nem o chamava — `handleLogout` só limpava o `localStorage`. Com o
 * access token valendo 24 horas e sem nenhuma denylist, **sair da conta
 * deixava um token válido por até um dia**.
 *
 * Isso importa mais do que parece porque o token não ficava só no
 * `localStorage`: até esta fatia ele viajava na querystring do redirect de
 * OAuth (`/dashboard?token=...`), então entrava no histórico do navegador, no
 * `Referer` e em qualquer log de proxy no caminho. Um token copiado de
 * qualquer um desses lugares continuava funcionando depois do logout.
 *
 * ─── POR QUE UMA CONSULTA POR REQUEST, E QUANDO ISSO MUDA ───────────────────
 *
 * `JwtStrategy.validate` passa a consultar esta tabela em toda requisição
 * autenticada. É uma leitura por chave primária numa tabela que guarda apenas
 * tokens revogados AINDA NÃO EXPIRADOS — ela não cresce com o uso da
 * plataforma, cresce com a taxa de logout, e o expurgo a mantém pequena.
 *
 * A alternativa seria um cache em memória do processo, e ela tem um defeito
 * que a descarta: com mais de um nó, o token revogado no nó A continuaria
 * aceito no nó B até o cache expirar. Uma revogação que vale "em alguns
 * segundos, em alguns servidores" não é uma revogação.
 *
 * Se a consulta virar gargalo medido, o Redis entra como cache NA FRENTE desta
 * tabela — não no lugar dela. O Redis aqui é opcional (`USE_REDIS`, e só no
 * game-server), e uma trava de segurança que depende de um serviço opcional
 * estar de pé não é uma trava.
 */
@Injectable()
export class RevogacaoService {
  private readonly logger = new Logger(RevogacaoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marca um token como revogado até a data em que ele expiraria de qualquer
   * forma.
   *
   * `upsert` e não `create`: dois logouts com o mesmo token — dois cliques no
   * botão, duas abas — não podem virar erro 500 por violação de chave primária.
   * Sair da conta duas vezes é sair da conta.
   */
  async revogar(jti: string, userId: string, expiraEm: Date): Promise<void> {
    await this.prisma.revokedToken.upsert({
      where: { jti },
      create: { jti, userId, expiresAt: expiraEm },
      update: {},
    });
  }

  /** `true` quando o token foi revogado e ainda não expirou. */
  async estaRevogado(jti: string): Promise<boolean> {
    const linha = await this.prisma.revokedToken.findUnique({
      where: { jti },
      select: { expiresAt: true },
    });
    if (!linha) return false;

    /**
     * Uma linha vencida vale como não revogada, e a diferença é sutil: o token
     * dela já é recusado pela expiração do próprio JWT. Tratá-la como
     * "revogado" daria o mesmo resultado; tratá-la como ausente é o que deixa
     * o expurgo abaixo poder rodar atrasado sem mudar comportamento nenhum.
     */
    return linha.expiresAt.getTime() > Date.now();
  }

  /**
   * Apaga as linhas cujos tokens já expiraram.
   *
   * Não há scheduler neste projeto (é uma pendência conhecida, junto do
   * expurgo LGPD dos 30 dias). Até haver, a limpeza é oportunista: roda no
   * logout, que é justamente quando uma linha nova entra. O custo é um
   * `deleteMany` indexado num caminho que não é crítico.
   *
   * Falhar aqui não pode derrubar o logout — a pessoa pediu para sair, e sair
   * já aconteceu. Por isso o erro vira log e não exceção.
   */
  async expurgarVencidos(): Promise<void> {
    try {
      await this.prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    } catch (erro) {
      this.logger.warn(`Falha ao expurgar tokens revogados vencidos: ${String(erro)}`);
    }
  }
}
