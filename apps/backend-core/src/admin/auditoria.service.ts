import { Injectable, Logger } from '@nestjs/common';
import { AdminAction, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service.js';
import type { RequisicaoAdmin } from './papeis.js';

/**
 * auditoria.service.ts — o rastro de toda ação administrativa (DOC-061 §6).
 *
 * O checklist de segurança do documento pede: "Todo Endpoint do módulo Admin
 * gera um rastro de Log de Auditoria inalterável". Este serviço é o único lugar
 * que escreve nele, e ele NÃO expõe update nem delete — um log que o próprio
 * administrador pode limpar responde à pergunta errada.
 *
 * ─── POR QUE OS RÓTULOS SÃO CONGELADOS ─────────────────────────────────────
 *
 * `actorLabel` e `targetLabel` guardam o username no MOMENTO da ação, mesmo
 * havendo relação para a tabela `users`. Dois motivos concretos:
 *
 *   - `actorId` vira NULL no expurgo de 30 dias (LGPD, §7.1). Sem a cópia, o
 *     histórico viraria "alguém suspendeu alguém";
 *   - username muda. Ler o nome ATUAL faria o log dizer que "arthur2" praticou
 *     uma ação que "arthur" praticou, o que é pior do que não registrar.
 *
 * ─── A ESCRITA NUNCA DERRUBA A AÇÃO ────────────────────────────────────────
 *
 * `registrar` engole a própria falha e loga. Não é descuido: se a tabela de
 * auditoria estiver indisponível, a alternativa seria recusar a suspensão de
 * uma conta abusiva — trocar "a ação ficou sem registro" por "a ação não
 * aconteceu". Numa emergência de moderação, a segunda é pior. A falha aparece
 * no log da aplicação, alto.
 */

/** O que a ação atingiu. String e não enum: novos alvos não pedem migração. */
export type TipoDeAlvo = 'user' | 'cosmetic' | 'report' | 'flag' | 'system';

export interface EntradaDeAuditoria {
  action: AdminAction;
  targetType: TipoDeAlvo;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava uma linha. `req` traz o autor (preenchido pelo `PapeisGuard`) e o IP.
   */
  async registrar(req: RequisicaoAdmin, entrada: EntradaDeAuditoria): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: req.autor.id,
          actorLabel: req.autor.username,
          action: entrada.action,
          targetType: entrada.targetType,
          targetId: entrada.targetId ?? null,
          targetLabel: entrada.targetLabel ?? null,
          reason: entrada.reason ?? null,
          metadata: entrada.metadata ?? {},
          ip: ipDaRequisicao(req),
        },
      });
    } catch (erro) {
      this.logger.error(
        `FALHA AO AUDITAR ${entrada.action} sobre ${entrada.targetType}:${entrada.targetId} por ${req.autor.username}: ${String(erro)}`,
      );
    }
  }

  /**
   * Página do histórico, mais recente primeiro.
   *
   * Cursor e não `skip`/`take`: o log cresce por inserção no topo, e um offset
   * numa lista que ganha linhas enquanto se navega repete e pula itens.
   */
  async listar(opcoes: {
    limite: number;
    cursor?: string;
    action?: AdminAction;
    actorId?: string;
    targetId?: string;
  }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (opcoes.action) where.action = opcoes.action;
    if (opcoes.actorId) where.actorId = opcoes.actorId;
    if (opcoes.targetId) where.targetId = opcoes.targetId;

    const linhas = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opcoes.limite + 1,
      ...(opcoes.cursor ? { cursor: { id: opcoes.cursor }, skip: 1 } : {}),
    });

    const temMais = linhas.length > opcoes.limite;
    const pagina = temMais ? linhas.slice(0, opcoes.limite) : linhas;

    return {
      itens: pagina,
      proximoCursor: temMais ? (pagina[pagina.length - 1]?.id ?? null) : null,
    };
  }
}

/**
 * IP de origem, atrás de proxy.
 *
 * O Render, o Fly e qualquer CDN põem o IP real em `x-forwarded-for` e o
 * `req.ip` passa a ser o do balanceador — o mesmo endereço para todo mundo, o
 * que torna o campo inútil justamente para o que ele existe: investigar acesso
 * indevido a uma conta administrativa.
 *
 * O PRIMEIRO da lista é o cliente; os seguintes são os proxies do caminho.
 */
function ipDaRequisicao(req: RequisicaoAdmin): string | null {
  const encaminhado = req.headers?.['x-forwarded-for'];
  const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
  const primeiro = bruto?.split(',')[0]?.trim();
  return (primeiro || req.ip || null)?.slice(0, 64) ?? null;
}
