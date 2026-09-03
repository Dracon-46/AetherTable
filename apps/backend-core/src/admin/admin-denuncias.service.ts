import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminAction, Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { AuditoriaService } from './auditoria.service.js';
import type { RequisicaoAdmin } from './papeis.js';
import type { CriarDenunciaDto, ListarDenunciasDto, ResolverDenunciaDto } from './admin.dto.js';

/**
 * admin-denuncias.service.ts — a central de moderação (DOC-061 §4).
 *
 * ─── A FILA ESTAVA VAZIA POR CONSTRUÇÃO ────────────────────────────────────
 *
 * A tabela `reports` existia no schema desde o início, com `status`,
 * `ReportReason` e as relações certas. E não havia UMA rota que escrevesse nela
 * — nem no painel (que não existia) nem no jogo. Quer dizer: o modelo de dados
 * previa moderação, e denunciar era impossível.
 *
 * Por isso este serviço tem os dois lados: `criar`, que um JOGADOR chama de
 * dentro da mesa, e a fila que o moderador trabalha. Um sem o outro é meio
 * sistema — uma fila que nunca enche, ou denúncias que ninguém lê.
 *
 * ─── ÁUDIO NÃO É GRAVADO ───────────────────────────────────────────────────
 *
 * O documento é explícito: ofensa verbal depende de denúncias MÚLTIPLAS para
 * gerar padrão de bloqueio. É por isso que `detalhar` traz a contagem de
 * denúncias abertas contra a mesma pessoa em destaque — numa denúncia de
 * conduta verbal, o número de denúncias distintas é a única evidência que
 * existe.
 */

const CAMPOS_DE_PESSOA = { id: true, username: true, displayName: true, avatarUrl: true };

@Injectable()
export class AdminDenunciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ─── Lado do jogador ───────────────────────────────────────────────────────

  /**
   * Denúncia feita de dentro da mesa.
   *
   * `snapshot` chega do cliente e é dado NÃO CONFIÁVEL — é texto que o
   * denunciante controla. Ele é guardado como evidência do que aquela pessoa
   * DIZ ter visto, nunca como fato: quem julga é o moderador, e a fila mostra
   * o snapshot como citação. O DTO limita a 60 linhas de 400 caracteres para a
   * rota não virar um canal de escrita arbitrária no banco.
   */
  async criar(denuncianteId: string, dto: CriarDenunciaDto) {
    if (dto.denunciadoId === denuncianteId) {
      throw new BadRequestException('Você não pode denunciar a si mesmo.');
    }

    const denunciado = await this.prisma.user.findFirst({
      where: { id: dto.denunciadoId, deletedAt: null },
      select: { id: true, username: true },
    });
    if (!denunciado) throw new NotFoundException('Jogador não encontrado.');

    /**
     * ─── REENVIAR A MESMA DENÚNCIA ATUALIZA, NÃO EMPILHA ───────────────────
     *
     * Insistir no botão não muda o caso, e a fila do moderador não deve encher
     * de duplicatas — um único usuário irritado geraria vinte itens. Devolver
     * 409 para quem está denunciando assédio no meio de uma partida também não
     * serve: a pessoa conclui que a denúncia não foi registrada.
     *
     * Então a segunda vez COMPLEMENTA a primeira, que é o que quem clica de
     * novo costuma querer.
     *
     * `roomCode: dto.roomCode ?? null` no `findFirst` compara com NULL de
     * verdade — é justamente o que um índice único não conseguiria fazer no
     * Postgres, onde NULLs são distintos. Ver o comentário do model `Report`.
     */
    const existente = await this.prisma.report.findFirst({
      where: {
        reporterId: denuncianteId,
        reportedId: dto.denunciadoId,
        reason: dto.motivo,
        roomCode: dto.roomCode ?? null,
      },
      select: { id: true },
    });

    const dados = {
      details: dto.detalhes ?? null,
      snapshot: dto.snapshot as Prisma.InputJsonValue,
    };

    const denuncia = existente
      ? await this.prisma.report.update({
          where: { id: existente.id },
          data: {
            ...dados,
            // Uma denúncia já encerrada que volta a ser enviada é um caso
            // NOVO: reabre. Sem isto, reincidência ficaria invisível.
            status: ReportStatus.OPEN,
            resolvedAt: null,
            resolvedById: null,
            resolution: null,
          },
          select: { id: true },
        })
      : await this.prisma.report.create({
          data: {
            reporterId: denuncianteId,
            reportedId: dto.denunciadoId,
            roomCode: dto.roomCode ?? null,
            reason: dto.motivo,
            ...dados,
          },
          select: { id: true },
        });

    return { id: denuncia.id, recebida: true };
  }

  // ─── Lado do moderador ─────────────────────────────────────────────────────

  async listar(dto: ListarDenunciasDto) {
    const where: Prisma.ReportWhereInput = dto.status ? { status: dto.status } : {};

    const linhas = await this.prisma.report.findMany({
      where,
      select: {
        id: true,
        reason: true,
        status: true,
        details: true,
        roomCode: true,
        createdAt: true,
        resolvedAt: true,
        resolution: true,
        reporter: { select: CAMPOS_DE_PESSOA },
        reported: { select: CAMPOS_DE_PESSOA },
        resolvedBy: { select: { id: true, username: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: dto.limite + 1,
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
    });

    const temMais = linhas.length > dto.limite;
    const pagina = temMais ? linhas.slice(0, dto.limite) : linhas;

    return {
      itens: pagina,
      proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  }

  /** Contagem por status — alimenta os contadores do painel. */
  async resumo() {
    const grupos = await this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } });
    const base: Record<ReportStatus, number> = {
      [ReportStatus.OPEN]: 0,
      [ReportStatus.REVIEWING]: 0,
      [ReportStatus.RESOLVED]: 0,
      [ReportStatus.DISMISSED]: 0,
    };
    for (const g of grupos) base[g.status] = g._count._all;
    return base;
  }

  /** A denúncia com a evidência e o histórico do denunciado. */
  async detalhar(id: string) {
    const denuncia = await this.prisma.report.findUnique({
      where: { id },
      select: {
        id: true,
        reason: true,
        status: true,
        details: true,
        roomCode: true,
        snapshot: true,
        createdAt: true,
        resolvedAt: true,
        resolution: true,
        reporter: { select: CAMPOS_DE_PESSOA },
        reported: { select: { ...CAMPOS_DE_PESSOA, suspendedUntil: true, deletedAt: true } },
        resolvedBy: { select: { id: true, username: true } },
      },
    });
    if (!denuncia) throw new NotFoundException('Denúncia não encontrada.');

    // O PADRÃO é a evidência quando não há gravação. Ver o cabeçalho.
    const [abertasContraEle, totalContraEle, outras] = await Promise.all([
      this.prisma.report.count({
        where: { reportedId: denuncia.reported.id, status: ReportStatus.OPEN },
      }),
      this.prisma.report.count({ where: { reportedId: denuncia.reported.id } }),
      this.prisma.report.findMany({
        where: { reportedId: denuncia.reported.id, id: { not: id } },
        select: {
          id: true,
          reason: true,
          status: true,
          createdAt: true,
          roomCode: true,
          reporter: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { ...denuncia, abertasContraEle, totalContraEle, outrasDenuncias: outras };
  }

  /** Marca em análise — evita dois moderadores trabalhando o mesmo caso. */
  async assumir(req: RequisicaoAdmin, id: string) {
    const denuncia = await this.exigirAberta(id);
    await this.prisma.report.update({
      where: { id },
      data: { status: ReportStatus.REVIEWING },
    });
    await this.auditoria.registrar(req, {
      action: AdminAction.REPORT_CLAIM,
      targetType: 'report',
      targetId: id,
      targetLabel: `${denuncia.reason} contra ${denuncia.reported.username}`,
    });
    return { status: ReportStatus.REVIEWING };
  }

  /**
   * Encerra o caso.
   *
   * `RESOLVED` = punição aplicada; `DISMISSED` = denúncia inválida. A punição
   * em si é uma ação SEPARADA, no módulo de usuários: encerrar a denúncia e
   * suspender a conta são decisões distintas, e juntá-las num botão faria toda
   * denúncia procedente virar suspensão automática.
   */
  async resolver(req: RequisicaoAdmin, id: string, dto: ResolverDenunciaDto) {
    const denuncia = await this.prisma.report.findUnique({
      where: { id },
      select: { id: true, status: true, reason: true, reported: { select: { username: true } } },
    });
    if (!denuncia) throw new NotFoundException('Denúncia não encontrada.');
    if (denuncia.status === ReportStatus.RESOLVED || denuncia.status === ReportStatus.DISMISSED) {
      throw new BadRequestException('Esta denúncia já foi encerrada.');
    }

    await this.prisma.report.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolucao,
        resolvedAt: new Date(),
        resolvedById: req.autor.id,
      },
    });

    await this.auditoria.registrar(req, {
      action:
        dto.status === ReportStatus.RESOLVED
          ? AdminAction.REPORT_RESOLVE
          : AdminAction.REPORT_DISMISS,
      targetType: 'report',
      targetId: id,
      targetLabel: `${denuncia.reason} contra ${denuncia.reported.username}`,
      reason: dto.resolucao,
    });

    return { status: dto.status };
  }

  private async exigirAberta(id: string) {
    const denuncia = await this.prisma.report.findUnique({
      where: { id },
      select: { id: true, status: true, reason: true, reported: { select: { username: true } } },
    });
    if (!denuncia) throw new NotFoundException('Denúncia não encontrada.');
    if (denuncia.status !== ReportStatus.OPEN) {
      throw new ForbiddenException('Esta denúncia não está aberta.');
    }
    return denuncia;
  }
}
