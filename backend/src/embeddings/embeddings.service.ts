import { Injectable } from '@nestjs/common';
import { GeminiEmbeddingsProvider } from './gemini-embeddings.provider';

// Thin facade over the embedding provider so the rest of the app is provider-
// agnostic (swap Gemini for another model behind this interface later).
@Injectable()
export class EmbeddingsService {
  constructor(private readonly provider: GeminiEmbeddingsProvider) {}

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }

  embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }
}
