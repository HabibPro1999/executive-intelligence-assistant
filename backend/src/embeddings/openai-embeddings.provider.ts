import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';

const BATCH_SIZE = 100;
const EXPECTED_EMBEDDING_DIMENSION = 768;

@Injectable()
export class OpenAiEmbeddingsProvider {
  private readonly logger = new Logger(OpenAiEmbeddingsProvider.name);
  private readonly baseUrl = config.ai.embeddings.baseUrl;
  private readonly model = config.ai.embeddings.model;
  private readonly dimensions = config.ai.embeddings.dimensions;

  constructor() {
    if (this.dimensions !== EXPECTED_EMBEDDING_DIMENSION) {
      throw new Error(
        `EMBEDDING_DIMENSIONS=${this.dimensions} is not supported by the fixed vector(${EXPECTED_EMBEDDING_DIMENSION}) schema.`,
      );
    }
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embed(texts, 'documents');
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'query');
    return vector;
  }

  private assertConfigured(): void {
    if (!config.ai.embeddings.apiKey) {
      throw new AppError(
        'OPENAI_API_KEY or EMBEDDING_API_KEY is not configured on the server.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private endpoint(): string {
    return `${this.baseUrl}/embeddings`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.ai.embeddings.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private handleFetchError(err: any): never {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new AppError(UserMessages.aiTimedOut, HttpStatus.GATEWAY_TIMEOUT);
    }
    throw err;
  }

  private handleHttpError(status: number, body: string): never {
    this.logger.error(`Embedding error ${status}: ${body.slice(0, 500)}`);
    if (status === 429) {
      throw new AppError(UserMessages.rateLimited, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new AppError(UserMessages.embeddingFailed, HttpStatus.BAD_GATEWAY);
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
      this.invalidResponse(`Embedding provider returned invalid values (${context}).`);
    }
    if (values.length !== this.dimensions) {
      this.invalidResponse(
        `Embedding provider returned ${values.length} dimensions, expected ${this.dimensions} (${context}).`,
      );
    }
    return values;
  }

  private async json(res: Response, context: string): Promise<any> {
    try {
      return await res.json();
    } catch {
      this.invalidResponse(`Embedding provider returned non-JSON response (${context}).`);
    }
  }

  private async embed(texts: string[], context: string): Promise<number[][]> {
    this.assertConfigured();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      let res: Response;
      try {
        res = await fetch(this.endpoint(), {
          method: 'POST',
          headers: this.headers(),
          signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
          body: JSON.stringify({
            model: this.model,
            input: batch,
            dimensions: this.dimensions,
          }),
        });
      } catch (err) {
        this.handleFetchError(err);
      }
      if (!res.ok) this.handleHttpError(res.status, await res.text());
      const data = await this.json(res, context);
      if (!Array.isArray(data?.data)) {
        this.invalidResponse('Embedding response missing data array.');
      }
      const ordered = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (ordered.length !== batch.length) {
        this.invalidResponse(
          `Embedding provider returned ${ordered.length} embeddings for ${batch.length} inputs.`,
        );
      }
      ordered.forEach((row: any, j: number) =>
        vectors.push(
          this.vectorFrom(row?.embedding, `${context} batch ${i / BATCH_SIZE}, item ${j}`),
        ),
      );
    }
    return vectors;
  }
}
