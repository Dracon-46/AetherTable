import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Pipe de validação Zod para os DTOs das rotas.
 *
 * O `ValidationPipe` do Nest depende de `class-validator`/`class-transformer`,
 * que este projeto não usa — o resto do monorepo já valida com Zod (as
 * intenções do game-server, a config de ambos os serviços). Um único vocabulário
 * de validação é mais fácil de auditar do que dois.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const resultado = this.schema.safeParse(value);
    if (resultado.success) return resultado.data;

    // Devolve o caminho e a mensagem, nunca o valor recebido: um corpo de
    // requisição de autenticação contém senha.
    throw new BadRequestException({
      message: 'Dados inválidos.',
      erros: resultado.error.issues.map((i) => ({
        campo: i.path.join('.') || '(raiz)',
        erro: i.message,
      })),
    });
  }
}
