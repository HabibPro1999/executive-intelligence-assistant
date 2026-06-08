import { Module } from '@nestjs/common';
import { GenerationService } from './generation.service';
import { OpenAiResponsesGenerationProvider } from './openai-responses-generation.provider';

@Module({
  providers: [GenerationService, OpenAiResponsesGenerationProvider],
  exports: [GenerationService],
})
export class GenerationModule {}
