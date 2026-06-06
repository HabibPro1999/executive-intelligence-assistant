import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentProcessingService } from './document-processing.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ChunkingModule } from '../chunking/chunking.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

@Module({
  imports: [
    ConversationsModule,
    ExtractionModule,
    ChunkingModule,
    EmbeddingsModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentProcessingService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
