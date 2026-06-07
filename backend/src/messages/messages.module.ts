import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { DocumentsModule } from '../documents/documents.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { GenerationModule } from '../generation/generation.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { WebResearchModule } from '../web-research/web-research.module';

@Module({
  imports: [
    ConversationsModule,
    DocumentsModule,
    RetrievalModule,
    GenerationModule,
    PreferencesModule,
    WebResearchModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
