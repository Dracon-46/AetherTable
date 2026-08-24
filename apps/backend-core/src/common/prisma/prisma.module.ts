import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * PrismaModule exportado globalmente (@Global).
 * 
 * Sendo global, ele não precisa ser importado nos módulos de feature (ex: UsersModule).
 * Basta declará-lo no AppModule e os serviços poderão injetar o PrismaService diretamente.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // Permite injeção em outros módulos
})
export class PrismaModule {}
