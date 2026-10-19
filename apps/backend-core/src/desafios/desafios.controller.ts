import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LIMITE_DE_JOGO_EM_CURSO } from '../common/limites.js';
import { DesafiosService } from './desafios.service.js';
import { ChaveDeDesafioParam, ImportarRecordesDto, RegistrarProgressoDto } from './desafios.dto.js';

/**
 * desafios.controller.ts — o progresso dos desafios da PRÓPRIA conta.
 *
 * Mora debaixo de `/users/me` porque é dado da conta autenticada e de mais
 * ninguém: não há rota para ler o progresso de outra pessoa, e o id vem do
 * token, nunca da URL.
 */
@ApiTags('Desafios')
@ApiBearerAuth()
@Controller('users/me/desafios')
@UseGuards(JwtAuthGuard)
export class DesafiosController {
  constructor(private readonly desafios: DesafiosService) {}

  @Get()
  @ApiOperation({ summary: 'Recorde, sequência e pergunta aberta de cada desafio da conta' })
  listar(@Request() req: RequisicaoAutenticada) {
    return this.desafios.listar(req.user.sub);
  }

  /**
   * Chamado DUAS vezes por pergunta — ao sortear e ao responder —, por isso o
   * limite folgado de `LIMITE_DE_JOGO_EM_CURSO`.
   */
  @Put(':chave')
  @Throttle(LIMITE_DE_JOGO_EM_CURSO)
  @ApiParam({ name: 'chave', example: 'mais-jogada' })
  @ApiOperation({ summary: 'Grava a sequência e a pergunta aberta; o recorde só sobe' })
  registrar(
    @Request() req: RequisicaoAutenticada,
    @Param('chave', new ZodValidationPipe(ChaveDeDesafioParam)) chave: string,
    @Body(new ZodValidationPipe(RegistrarProgressoDto)) body: RegistrarProgressoDto,
  ) {
    return this.desafios.registrar(req.user.sub, chave, body);
  }

  /** 200 e não 201: o que volta é o mapa inteiro, não um recurso criado. */
  @Post('importar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sobe os recordes que o navegador guardava: max(atual, enviado)' })
  importar(
    @Request() req: RequisicaoAutenticada,
    @Body(new ZodValidationPipe(ImportarRecordesDto)) body: ImportarRecordesDto,
  ) {
    return this.desafios.importar(req.user.sub, body);
  }
}
