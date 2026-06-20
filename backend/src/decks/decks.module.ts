import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { DocumentsModule } from '../documents/documents.module';
import { GenerationModule } from '../generation/generation.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { DecksController } from './decks.controller';
import { DecksService } from './decks.service';
import { PptxDeckRenderer } from './pptx-deck.renderer';
import { NextGenDeckRenderer } from './nextgen-deck.renderer';

@Module({
  imports: [
    ConversationsModule,
    DocumentsModule,
    RetrievalModule,
    GenerationModule,
    PreferencesModule,
  ],
  controllers: [DecksController],
  providers: [DecksService, PptxDeckRenderer, NextGenDeckRenderer],
})
export class DecksModule {}
