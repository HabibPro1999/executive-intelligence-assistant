import { Module } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { GeminiGenerationProvider } from './gemini-generation.provider';

@Module({
  providers: [GenerationService, GeminiGenerationProvider],
  exports: [GenerationService],
})
export class GenerationModule {}
