import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module.js';
import { CatalogoDeCosmeticosService } from './catalogo.service.js';
import { CatalogoDeCosmeticosController } from './catalogo.controller.js';

/**
 * O catálogo autoral é exportado porque o módulo de admin precisa invalidá-lo
 * depois de cada escrita — sem isso, um cosmético criado só apareceria no
 * próximo boot.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CatalogoDeCosmeticosController],
  providers: [CatalogoDeCosmeticosService],
  exports: [CatalogoDeCosmeticosService],
})
export class CosmeticosModule {}
