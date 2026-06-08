import { Injectable } from '@nestjs/common';
import { OpenAiEmbeddingsProvider } from './openai-embeddings.provider';

// Thin facade over the embedding provider so the rest of the app is provider-
// agnostic.
@Injectable()
export class EmbeddingsService {
  constructor(private readonly provider: OpenAiEmbeddingsProvider) {}

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }

  embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }
}
