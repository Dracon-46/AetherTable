import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';

/**
 * Serviço responsável por gerenciar o ciclo de vida da conexão com o banco de dados via Prisma.
 * Estende PrismaClient para aproveitar todas as tipagens geradas a partir do schema.prisma.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly logger: PinoLogger) {
    // Configura o logger contexto
    super();
    this.logger.setContext(PrismaService.name);
  }

  /**
   * Executado quando o módulo é inicializado.
   * Abre a conexão com o banco de dados ativamente.
   */
  async onModuleInit() {
    this.logger.info('Inicializando conexão com o PostgreSQL...');
    await this.$connect();
    this.logger.info('Conexão com o banco de dados estabelecida com sucesso.');
  }

  /**
   * Executado quando a aplicação é encerrada.
   * Garante o fechamento limpo das conexões para não deixar pools órfãos.
   */
  async onModuleDestroy() {
    this.logger.info('Encerrando conexão com o banco de dados...');
    await this.$disconnect();
    this.logger.info('Conexão encerrada com segurança.');
  }
}
