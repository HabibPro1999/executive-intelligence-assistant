import { Module } from '@nestjs/common';
import { ChunkingModule } from '../chunking/chunking.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { GenerationModule } from '../generation/generation.module';
import { WebResearchService } from './web-research.service';

@Module({
  imports: [ChunkingModule, EmbeddingsModule, GenerationModule],
  providers: [WebResearchService],
  exports: [WebResearchService],
})
export class WebResearchModule {}
