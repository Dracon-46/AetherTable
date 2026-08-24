import { Module } from '@nestjs/common';
import { DecksController, InternalDecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';

@Module({
  controllers: [DecksController, InternalDecksController],
  providers: [DecksService],
  exports: [DecksService],
})
export class DecksModule {}
