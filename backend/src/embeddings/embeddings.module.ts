import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { OpenAiEmbeddingsProvider } from './openai-embeddings.provider';

@Module({
  providers: [EmbeddingsService, OpenAiEmbeddingsProvider],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
