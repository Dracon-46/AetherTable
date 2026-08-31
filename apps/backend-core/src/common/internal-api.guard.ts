import type { CanActivate } from '@nestjs/common';
import { type ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * internal-api.guard.ts — protege as rotas máquina-a-máquina.
 *
 * O `InternalDecksController` (`GET /api/v1/internal/decks/:id`) não tinha
 * guard NENHUM. Qualquer pessoa com a URL da API e um id de deck baixava o
 * decklist inteiro de qualquer jogador — inclusive durante a partida, quando a
 * lista das cartas é exatamente a informação que o motor de visibilidade
 * inteiro existe para esconder (RN02, DOC-032). O game-server é o único
 * consumidor legítimo dessa rota.
 *
 * O segredo é o mesmo par de confiança que já existe entre os dois serviços.
 * Em produção, sem `INTERNAL_API_TOKEN` configurado, a rota FECHA — falhar
 * fechado é a única opção defensável aqui.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperado = this.config.get<string>('INTERNAL_API_TOKEN');
    const producao = this.config.get<string>('NODE_ENV') === 'production';

    if (!esperado) {
      if (producao) {
        this.logger.error(
          'INTERNAL_API_TOKEN ausente em produção: as rotas internas estão fechadas.',
        );
        throw new UnauthorizedException();
      }
      // Em dev, sem segredo configurado, seguimos — mas com aviso, para que a
      // ausência não passe despercebida até o deploy.
      this.logger.warn(
        'INTERNAL_API_TOKEN não configurado: rotas internas abertas apenas porque NODE_ENV != production.',
      );
      return true;
    }

    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const recebido = req.headers['x-internal-token'];
    if (typeof recebido !== 'string' || !seguroIgual(recebido, esperado)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/**
 * Comparação em tempo constante. `a === b` sai no primeiro byte diferente e
 * vaza, por tempo, o prefixo correto do segredo.
 */
function seguroIgual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}
