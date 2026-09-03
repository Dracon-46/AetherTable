import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service.js';

/**
 * papeis.ts — o controle de acesso do backoffice (DOC-061 §1).
 *
 * ─── POR QUE O PAPEL É LIDO DO BANCO, E NÃO DO JWT ─────────────────────────
 *
 * O caminho barato seria pôr `role` dentro do token e conferir ali: zero
 * consulta por requisição. Só que o token vale SETE DIAS (`JWT_ACCESS_TTL`).
 * Quer dizer: despromover um administrador comprometido não teria efeito
 * nenhum durante uma semana, e a única saída seria trocar o `JWT_SECRET` —
 * derrubando a sessão de todos os jogadores para revogar o acesso de um.
 *
 * Uma consulta por requisição administrativa é irrelevante: o tráfego do
 * backoffice é de dezenas de requisições por dia, não de milhares por segundo.
 * O que ela compra é revogação IMEDIATA, que é o requisito real de um painel
 * que pode apagar contas.
 *
 * A mesma consulta resolve dois outros casos que o token não veria:
 *
 *   - conta com `deletedAt` — um admin banido continuaria admin até o token
 *     expirar;
 *   - conta suspensa — a suspensão passaria a valer só para o login, e quem
 *     já estivesse com token na mão seguiria administrando.
 */

export const CHAVE_DE_PAPEIS = 'aether:papeis';

/**
 * Papel mínimo da rota. Sem o decorador, a rota exige ADMIN — o padrão SEGURO
 * é o restritivo: uma rota nova nasce fechada, e é preciso um ato explícito
 * para abri-la a moderadores.
 */
export const Papeis = (...papeis: Role[]) => SetMetadata(CHAVE_DE_PAPEIS, papeis);

/** Hierarquia. ADMIN passa em qualquer lugar onde MOD passa. */
const NIVEL: Record<Role, number> = {
  [Role.USER]: 0,
  [Role.MOD]: 1,
  [Role.ADMIN]: 2,
};

@Injectable()
export class PapeisGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const exigidos = this.reflector.getAllAndOverride<Role[]>(CHAVE_DE_PAPEIS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]) ?? [Role.ADMIN];

    const req = contexto.switchToHttp().getRequest<{
      user?: { sub?: string };
      /** Preenchido aqui para os serviços não repetirem a consulta. */
      autor?: { id: string; username: string; role: Role };
    }>();

    const id = req.user?.sub;
    if (!id) throw new UnauthorizedException('Sessão ausente.');

    const usuario = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, username: true, role: true, suspendedUntil: true },
    });

    /**
     * MESMA RESPOSTA para conta inexistente, apagada, suspensa e sem papel.
     *
     * Um 403 diferente por caso transformaria a rota num oráculo: dá para
     * descobrir se um id existe, se foi banido e qual o papel dele, tudo sem
     * ter acesso. Quem tem direito não precisa da distinção; quem não tem, não
     * deve recebê-la.
     */
    const suspenso = Boolean(
      usuario?.suspendedUntil && usuario.suspendedUntil.getTime() > Date.now(),
    );
    const nivel = usuario ? NIVEL[usuario.role] : -1;
    const minimo = Math.min(...exigidos.map((p) => NIVEL[p]));

    if (!usuario || suspenso || nivel < minimo) {
      throw new ForbiddenException('Você não tem acesso a esta área.');
    }

    req.autor = { id: usuario.id, username: usuario.username, role: usuario.role };
    return true;
  }
}

/** `req` depois do `PapeisGuard`. O autor vem preenchido. */
export interface RequisicaoAdmin {
  user: { sub: string; username: string };
  autor: { id: string; username: string; role: Role };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}
