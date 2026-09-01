import { Module } from '@nestjs/common';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
import { CardImageService } from './card-image.service.js';
import { scryfallClientProvider } from './scryfall.provider.js';

/**
 * Módulo do espelho da Scryfall: arte e metadados servidos pelo nosso domínio,
 * para que o navegador nunca precise alcançar `scryfall.io` (DOC-035 §3).
 */
@Module({
  controllers: [CardsController],
  providers: [scryfallClientProvider, CardsService, CardImageService],
  exports: [CardsService, CardImageService],
})
export class CardsModule {}
