import { Module } from '@nestjs/common';
import { CardsModule } from '../cards/cards.module.js';
import { CosmeticosModule } from '../cosmeticos/cosmeticos.module.js';
import { AdminController } from './admin.controller.js';
import { DenunciasController } from './denuncias.controller.js';
import { AuditoriaService } from './auditoria.service.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';
import { AdminDenunciasService } from './admin-denuncias.service.js';
import { AdminSistemaService } from './admin-sistema.service.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { PapeisGuard } from './papeis.js';

/**
 * admin.module.ts — o backoffice (DOC-061).
 *
 * `CardsModule` entra porque o botão de esvaziar o cache da Scryfall
 * (DOC-061 §5) precisa do `CardsService` — o cache é em memória, então não há
 * como limpá-lo por fora do processo que o mantém.
 *
 * `CosmeticosModule` entra pelo mesmo motivo: criar ou desativar um cosmético
 * precisa chegar ao catálogo em memória na hora, senão o item só apareceria
 * para os jogadores no próximo boot do processo.
 *
 * `PapeisGuard` é provider do módulo e NÃO guardião global: aplicá-lo a toda a
 * aplicação faria cada rota de jogador pagar uma consulta de papel no banco,
 * para responder uma pergunta que só as rotas administrativas fazem.
 */
@Module({
  imports: [CardsModule, CosmeticosModule],
  controllers: [AdminController, DenunciasController],
  providers: [
    PapeisGuard,
    AuditoriaService,
    AdminUsuariosService,
    AdminDenunciasService,
    AdminSistemaService,
    AdminBootstrapService,
  ],
  exports: [AdminSistemaService],
})
export class AdminModule {}
