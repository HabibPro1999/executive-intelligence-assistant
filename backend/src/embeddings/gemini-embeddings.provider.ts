import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
// Gemini batchEmbedContents accepts up to 100 requests per call.
const BATCH_SIZE = 100;
const EXPECTED_EMBEDDING_DIMENSION = 768;
const SUPPORTED_EMBEDDING_DIMENSIONS: Record<string, number> = {
  'gemini-embedding-001': 768,
  'gemini-embedding-2-preview': 768,
  'gemini-embedding-2': 768,
};

type GeminiTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

// Low-level Gemini Embedding API client. Same model for documents and queries.
@Injectable()
export class GeminiEmbeddingsProvider {
  private readonly logger = new Logger(GeminiEmbeddingsProvider.name);
  private readonly model = config.gemini.embeddingModel;
  private readonly expectedDimension: number;

  constructor() {
    const dimension = SUPPORTED_EMBEDDING_DIMENSIONS[this.model];
    if (dimension !== EXPECTED_EMBEDDING_DIMENSION) {
      throw new Error(
        `GEMINI_EMBEDDING_MODEL=${this.model} is not supported by the fixed vector(${EXPECTED_EMBEDDING_DIMENSION}) schema.`,
      );
    }
    this.expectedDimension = dimension;
  }

  private modelPath(): string {
    return `models/${this.model}`;
  }

  private assertConfigured(): void {
    if (!config.gemini.apiKey) {
      throw new AppError(
        'GEMINI_API_KEY is not configured on the server.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private handleHttpError(status: number, body: string): never {
    this.logger.error(`Gemini embedding error ${status}: ${body.slice(0, 500)}`);
    if (status === 429) {
      throw new AppError(UserMessages.rateLimited, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new AppError(UserMessages.embeddingFailed, HttpStatus.BAD_GATEWAY);
  }

  private handleFetchError(err: any): never {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new AppError(UserMessages.aiTimedOut, HttpStatus.GATEWAY_TIMEOUT);
    }
    throw err;
  }

  private invalidResponse(message: string): never {
    this.logger.error(message);
    throw new AppError(UserMessages.embeddingFailed, HttpStatus.BAD_GATEWAY);
  }

  private vectorFrom(values: unknown, context: string): number[] {
    if (
      !Array.isArray(values) ||
      !values.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      this.invalidResponse(`Gemini returned invalid embedding values (${context}).`);
    }
    if (values.length !== this.expectedDimension) {
      this.invalidResponse(
        `Gemini returned ${values.length} dimensions, expected ${this.expectedDimension} (${context}).`,
      );
    }
    return values;
  }

  private async json(res: Response, context: string): Promise<any> {
    try {
      return await res.json();
    } catch {
      this.invalidResponse(`Gemini returned non-JSON embedding response (${context}).`);
    }
  }

  // Embed a batch of document chunks. Returns one vector per input, in order.
  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.assertConfigured();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const url = `${BASE}${this.modelPath()}:batchEmbedContents?key=${config.gemini.apiKey}`;
      const requests = batch.map((text) => ({
        model: this.modelPath(),
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT' as GeminiTaskType,
        outputDimensionality: this.expectedDimension,
      }));
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(config.gemini.requestTimeoutMs),
          body: JSON.stringify({ requests }),
        });
      } catch (err) {
        this.handleFetchError(err);
      }
      if (!res.ok) this.handleHttpError(res.status, await res.text());
      const data = await this.json(res, 'batch');
      if (!Array.isArray(data?.embeddings)) {
        this.invalidResponse('Gemini batch embedding response missing embeddings.');
      }
      if (data.embeddings.length !== batch.length) {
        this.invalidResponse(
          `Gemini returned ${data.embeddings.length} embeddings for ${batch.length} inputs.`,
        );
      }
      data.embeddings.forEach((e: any, j: number) =>
        vectors.push(this.vectorFrom(e?.values, `batch ${i / BATCH_SIZE}, item ${j}`)),
      );
    }
    return vectors;
  }

  // Embed a single user query.
  async embedQuery(text: string): Promise<number[]> {
    this.assertConfigured();
    const url = `${BASE}${this.modelPath()}:embedContent?key=${config.gemini.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.gemini.requestTimeoutMs),
        body: JSON.stringify({
          model: this.modelPath(),
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY' as GeminiTaskType,
          outputDimensionality: this.expectedDimension,
        }),
      });
    } catch (err) {
      this.handleFetchError(err);
    }
    if (!res.ok) this.handleHttpError(res.status, await res.text());
    const data = await this.json(res, 'query');
    return this.vectorFrom(data?.embedding?.values, 'query');
  }
}
