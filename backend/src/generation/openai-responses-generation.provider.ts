import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';
import { GenerateResult, GroundingMetadata, StreamChunk } from './generation.types';

interface WebSourceCandidate {
  url: string;
  title?: string;
}

@Injectable()
export class OpenAiResponsesGenerationProvider {
  private readonly logger = new Logger(OpenAiResponsesGenerationProvider.name);
  private readonly baseUrl = config.ai.generation.baseUrl;
  private readonly model = config.ai.generation.model;

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const result = await this.generateContent(systemPrompt, userPrompt, options, false);
    return result.text;
  }

  generateWithWebSearch(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<GenerateResult> {
    return this.generateContent(systemPrompt, userPrompt, options, true);
  }

  stream(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): AsyncGenerator<StreamChunk> {
    return this.streamContent(systemPrompt, userPrompt, options, false);
  }

  streamWithWebSearch(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): AsyncGenerator<StreamChunk> {
    return this.streamContent(systemPrompt, userPrompt, options, true);
  }

  private assertConfigured(): void {
    if (!config.ai.generation.apiKey) {
      throw new AppError(
        'OPENAI_API_KEY is not configured on the server.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private endpoint(): string {
    return `${this.baseUrl}/responses`;
  }

  private requestBody(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number },
    webSearch: boolean,
    stream = false,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userPrompt,
      temperature: options.temperature ?? 0.2,
      max_output_tokens: options.maxOutputTokens ?? 2048,
      stream,
    };

    if (webSearch) {
      body.tools = [{ type: 'web_search' }];
      body.tool_choice = 'required';
      body.include = ['web_search_call.action.sources'];
    }

    return body;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${config.ai.generation.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private handleFetchError(err: any): never {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new AppError(UserMessages.aiTimedOut, HttpStatus.GATEWAY_TIMEOUT);
    }
    throw err;
  }

  private handleHttpError(status: number, body: string, context: string): never {
    this.logger.error(`OpenAI ${context} error ${status}: ${body.slice(0, 500)}`);
    if (status === 429) {
      throw new AppError(UserMessages.rateLimited, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
  }

  private generationFailure(reason?: string | null): never {
    if (reason === 'max_output_tokens' || reason === 'length') {
      throw new AppError(UserMessages.llmTruncated, HttpStatus.BAD_GATEWAY);
    }
    if (reason === 'content_filter' || reason === 'safety') {
      throw new AppError(UserMessages.llmBlocked, HttpStatus.BAD_GATEWAY);
    }
    throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
  }

  private validateStatus(data: any, context: string): void {
    if (data?.error) {
      this.logger.error(
        `OpenAI ${context} error: ${data.error.message ?? 'unknown'}`,
      );
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    const status = data?.status;
    if (!status || status === 'completed') return;
    const reason = data?.incomplete_details?.reason ?? status;
    this.logger.error(`OpenAI ${context} ended with status=${status}, reason=${reason}`);
    this.generationFailure(reason);
  }

  private textFromResponse(data: any): string {
    if (typeof data?.output_text === 'string') return data.output_text.trim();
    const output = data?.output;
    if (!Array.isArray(output)) return '';
    return output
      .map((item: any) =>
        Array.isArray(item?.content)
          ? item.content
              .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
              .join('')
          : '',
      )
      .join('')
      .trim();
  }

  private addSource(
    source: unknown,
    sources: Map<string, WebSourceCandidate>,
  ): void {
    if (!source || typeof source !== 'object') return;
    const obj = source as any;
    const citation =
      obj.url_citation && typeof obj.url_citation === 'object'
        ? obj.url_citation
        : obj;
    const url =
      typeof citation.url === 'string'
        ? citation.url
        : typeof citation.uri === 'string'
          ? citation.uri
          : null;
    if (!url) return;
    const title =
      typeof citation.title === 'string' && citation.title.trim()
        ? citation.title.trim()
        : undefined;
    if (!sources.has(url)) sources.set(url, { url, title });
  }

  private addQuery(query: unknown, queries: Set<string>): void {
    if (typeof query === 'string' && query.trim()) {
      queries.add(query.trim());
      return;
    }
    if (!query || typeof query !== 'object') return;
    const obj = query as any;
    if (typeof obj.query === 'string' && obj.query.trim()) {
      queries.add(obj.query.trim());
    }
  }

  private collectGrounding(
    response: unknown,
    sources: Map<string, WebSourceCandidate>,
    queries: Set<string>,
  ): void {
    if (!response || typeof response !== 'object') return;
    const data = response as any;
    if (data.annotation) this.addSource(data.annotation, sources);
    if (Array.isArray(data.annotations)) {
      data.annotations.forEach((annotation: unknown) =>
        this.addSource(annotation, sources),
      );
    }

    const output = Array.isArray(data.output) ? data.output : [];
    for (const item of output) {
      if (item?.type === 'web_search_call') {
        const action = item.action;
        if (Array.isArray(action?.queries)) {
          action.queries.forEach((query: unknown) => this.addQuery(query, queries));
        }
        if (Array.isArray(action?.sources)) {
          action.sources.forEach((source: unknown) => this.addSource(source, sources));
        }
      }

      const content = Array.isArray(item?.content) ? item.content : [];
      for (const part of content) {
        if (Array.isArray(part?.annotations)) {
          part.annotations.forEach((annotation: unknown) =>
            this.addSource(annotation, sources),
          );
        }
      }
    }
  }

  private toGroundingMetadata(
    sources: Map<string, WebSourceCandidate>,
    queries: Set<string>,
  ): GroundingMetadata | undefined {
    if (!sources.size && !queries.size) return undefined;
    return {
      webSearchQueries: [...queries],
      groundingChunks: [...sources.values()].map((source) => ({
        web: { uri: source.url, title: source.title },
      })),
      groundingSupports: [],
    };
  }

  private async generateContent(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number },
    webSearch: boolean,
  ): Promise<GenerateResult> {
    this.assertConfigured();

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
        body: JSON.stringify(
          this.requestBody(systemPrompt, userPrompt, options, webSearch),
        ),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (!res.ok) this.handleHttpError(res.status, await res.text(), 'generation');

    let data: any;
    try {
      data = await res.json();
    } catch {
      this.logger.error('OpenAI generation returned non-JSON response.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    this.validateStatus(data, 'generation');
    const text = this.textFromResponse(data);
    if (!text) {
      this.logger.error('OpenAI returned no text.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    const sources = new Map<string, WebSourceCandidate>();
    const queries = new Set<string>();
    this.collectGrounding(data, sources, queries);
    return {
      text,
      groundingMetadata: this.toGroundingMetadata(sources, queries),
    };
  }

  private async *streamContent(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number },
    webSearch: boolean,
  ): AsyncGenerator<StreamChunk> {
    this.assertConfigured();

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
        body: JSON.stringify(
          this.requestBody(systemPrompt, userPrompt, options, webSearch, true),
        ),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (!res.ok) this.handleHttpError(res.status, await res.text(), 'stream');
    if (!res.body) {
      this.logger.error('OpenAI stream returned no body.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    let sawText = false;
    const sources = new Map<string, WebSourceCandidate>();
    const queries = new Set<string>();

    for await (const data of this.readSse(res.body)) {
      if (data?.type === 'error' || data?.error) {
        this.logger.error(
          `OpenAI stream error: ${data?.error?.message ?? data?.message ?? 'unknown'}`,
        );
        throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
      }

      this.collectGrounding(data, sources, queries);
      if (data?.response) this.collectGrounding(data.response, sources, queries);

      if (data?.type === 'response.output_text.delta' && typeof data.delta === 'string') {
        sawText = true;
        yield { text: data.delta };
        continue;
      }

      if (data?.type === 'response.completed') {
        this.validateStatus(data.response, 'stream');
      }

      if (data?.type === 'response.failed' || data?.type === 'response.incomplete') {
        this.validateStatus(data.response ?? data, 'stream');
      }
    }

    if (!sawText) {
      this.logger.error('OpenAI stream completed without text.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    const groundingMetadata = this.toGroundingMetadata(sources, queries);
    if (groundingMetadata) yield { groundingMetadata };
  }

  private async *readSse(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<any> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          yield JSON.parse(data);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
