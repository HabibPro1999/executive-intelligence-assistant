import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { DocumentsModule } from '../documents/documents.module';
import { GenerationModule } from '../generation/generation.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { DecksController } from './decks.controller';
import { DecksService } from './decks.service';
import { PptxDeckRenderer } from './pptx-deck.renderer';

@Module({
  imports: [
    ConversationsModule,
    DocumentsModule,
    RetrievalModule,
    GenerationModule,
  ],
  controllers: [DecksController],
  providers: [DecksService, PptxDeckRenderer],
})
export class DecksModule {}
