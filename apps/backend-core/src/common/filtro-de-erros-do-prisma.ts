import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

/**
 * filtro-de-erros-do-prisma.ts — o 500 que era um 409 ou um 404.
 *
 * ─── O QUE ACONTECIA ────────────────────────────────────────────────────────
 *
 * Nenhum filtro traduzia erro do Prisma. Duas situações comuns subiam como
 * `500 Internal server error`:
 *
 *   P2002 — violação de chave única. Mover para a reserva uma carta que já
 *           estava lá, trocar a impressão para uma que o deck já tinha, dois
 *           cliques simultâneos criando a mesma linha. É conflito do pedido,
 *           não falha do servidor.
 *   P2025 — o registro sumiu entre a checagem e a escrita (outra aba apagou a
 *           carta). É "não existe", não "o servidor quebrou".
 *
 * O 500 tinha dois efeitos ruins: a tela mostrava "erro inesperado" para uma
 * situação que a pessoa entende ("já está lá"), e o log de erro do servidor
 * enchia de ruído que esconde as falhas de verdade.
 *
 * ─── POR QUE GLOBAL, E NÃO UM try/catch EM CADA ROTA ────────────────────────
 *
 * Os serviços já tratam os casos que conhecem (a fusão de quantidades em
 * `DecksService`, por exemplo). O que sobra são corridas entre a leitura e a
 * escrita, que podem acontecer em QUALQUER rota que escreve — e um try/catch
 * por rota seria esquecido na próxima rota criada.
 *
 * Qualquer outro código do Prisma segue para o tratamento padrão do Nest (500
 * com log): traduzir o que não se entende seria esconder um defeito.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class FiltroDeErrosDoPrisma extends BaseExceptionFilter {
  override catch(erro: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    super.catch(traduzirErroDoPrisma(erro) ?? erro, host);
  }
}

/** A exceção HTTP equivalente, ou `null` quando o código não tem tradução segura. */
export function traduzirErroDoPrisma(
  erro: Prisma.PrismaClientKnownRequestError,
): HttpException | null {
  switch (erro.code) {
    case 'P2002':
      return new ConflictException('Já existe um registro com estes dados.');
    case 'P2025':
      return new NotFoundException('O registro não existe mais.');
    default:
      return null;
  }
}
