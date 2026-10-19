import { Module } from '@nestjs/common';
import { DesafiosController } from './desafios.controller.js';
import { DesafiosService } from './desafios.service.js';

/** O progresso dos desafios (os minigames) por conta. Ver `DesafiosService`. */
@Module({
  controllers: [DesafiosController],
  providers: [DesafiosService],
})
export class DesafiosModule {}
