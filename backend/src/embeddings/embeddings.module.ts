import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { GeminiEmbeddingsProvider } from './gemini-embeddings.provider';

@Module({
  providers: [EmbeddingsService, GeminiEmbeddingsProvider],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
