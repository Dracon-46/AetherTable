import { Module } from '@nestjs/common';
import { DecksController, InternalDecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { ExplorarController } from './explorar.controller.js';
import { ExplorarService } from './explorar.service.js';
import { DecksIniciaisController } from './decks-iniciais.controller.js';
import { DecksIniciaisService } from './decks-iniciais.service.js';
import { GeradorDeDeckService } from './gerador/gerador-de-deck.service.js';
import { CardsModule } from '../cards/cards.module.js';

/**
 * `CardsModule` entra aqui porque a hidratação do grimório passou a usar o
 * espelho cacheado da Scryfall (`CardsService.collection`) em vez de `fetch`
 * cru — ver o cabeçalho de `decks.service.ts`.
 */
@Module({
  imports: [CardsModule],
  controllers: [
    DecksController,
    InternalDecksController,
    ExplorarController,
    DecksIniciaisController,
  ],
  providers: [DecksService, ExplorarService, DecksIniciaisService, GeradorDeDeckService],
  exports: [DecksService],
})
export class DecksModule {}
