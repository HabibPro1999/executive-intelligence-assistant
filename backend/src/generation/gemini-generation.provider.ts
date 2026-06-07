import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/';

export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  groundingSupports?: unknown[];
  searchEntryPoint?: unknown;
}

export interface GeminiGenerateResult {
  text: string;
  groundingMetadata?: GeminiGroundingMetadata;
}

export interface GeminiStreamChunk {
  text?: string;
  groundingMetadata?: GeminiGroundingMetadata;
}

// Low-level Gemini Flash text-generation client.
@Injectable()
export class GeminiGenerationProvider {
  private readonly logger = new Logger(GeminiGenerationProvider.name);
  private readonly model = config.gemini.generationModel;

  private handleFetchError(err: any): never {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new AppError(UserMessages.aiTimedOut, HttpStatus.GATEWAY_TIMEOUT);
    }
    throw err;
  }

  private generationFailure(finishReason?: string): never {
    if (finishReason === 'MAX_TOKENS') {
      throw new AppError(UserMessages.llmTruncated, HttpStatus.BAD_GATEWAY);
    }
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      throw new AppError(UserMessages.llmBlocked, HttpStatus.BAD_GATEWAY);
    }
    throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    const result = await this.generateContent(systemPrompt, userPrompt, options);
    return result.text;
  }

  async generateWithGoogleSearch(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<GeminiGenerateResult> {
    return this.generateContent(systemPrompt, userPrompt, options, [
      { google_search: {} },
    ]);
  }

  stream(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): AsyncGenerator<GeminiStreamChunk> {
    return this.streamContent(systemPrompt, userPrompt, options);
  }

  streamWithGoogleSearch(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): AsyncGenerator<GeminiStreamChunk> {
    return this.streamContent(systemPrompt, userPrompt, options, [
      { google_search: {} },
    ]);
  }

  private async generateContent(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
    tools?: Record<string, unknown>[],
  ): Promise<GeminiGenerateResult> {
    if (!config.gemini.apiKey) {
      throw new AppError(
        'GEMINI_API_KEY is not configured on the server.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const url = `${BASE}models/${this.model}:generateContent?key=${config.gemini.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.gemini.requestTimeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: this.generationConfig(options),
          ...(tools?.length ? { tools } : {}),
        }),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Gemini generation error ${res.status}: ${body.slice(0, 500)}`,
      );
      if (res.status === 429) {
        throw new AppError(
          UserMessages.rateLimited,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    let data: {
      promptFeedback?: { blockReason?: string };
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
        groundingMetadata?: GeminiGroundingMetadata;
      }[];
    };
    try {
      data = await res.json();
    } catch {
      this.logger.error('Gemini returned non-JSON generation response.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }
    if (data.promptFeedback?.blockReason) {
      this.logger.warn(
        `Gemini blocked prompt (blockReason=${data.promptFeedback.blockReason})`,
      );
      throw new AppError(UserMessages.llmBlocked, HttpStatus.BAD_GATEWAY);
    }

    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      this.logger.warn(
        `Gemini returned non-terminal answer (finishReason=${candidate.finishReason})`,
      );
      this.generationFailure(candidate.finishReason);
    }

    const text = candidate?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!text) {
      this.logger.error(
        `Gemini returned no text (finishReason=${candidate?.finishReason})`,
      );
      this.generationFailure(candidate?.finishReason);
    }
    return {
      text,
      groundingMetadata: candidate?.groundingMetadata,
    };
  }

  private async *streamContent(
    systemPrompt: string,
    userPrompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
    tools?: Record<string, unknown>[],
  ): AsyncGenerator<GeminiStreamChunk> {
    if (!config.gemini.apiKey) {
      throw new AppError(
        'GEMINI_API_KEY is not configured on the server.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const url =
      `${BASE}models/${this.model}:streamGenerateContent` +
      `?alt=sse&key=${config.gemini.apiKey}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(config.gemini.requestTimeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: this.generationConfig(options),
          ...(tools?.length ? { tools } : {}),
        }),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(
        `Gemini stream error ${res.status}: ${body.slice(0, 500)}`,
      );
      if (res.status === 429) {
        throw new AppError(UserMessages.rateLimited, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    if (!res.body) {
      this.logger.error('Gemini stream returned no body.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }

    let sawText = false;
    for await (const data of this.readSse(res.body)) {
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        this.logger.warn(
          `Gemini stream returned non-terminal answer (finishReason=${candidate.finishReason})`,
        );
        this.generationFailure(candidate.finishReason);
      }
      const text = candidate?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '')
        .join('');
      if (text) sawText = true;
      if (text || candidate?.groundingMetadata) {
        yield {
          text,
          groundingMetadata: candidate?.groundingMetadata,
        };
      }
    }

    if (!sawText) {
      this.logger.error('Gemini stream completed without text.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }
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
      const tail = buffer.trim();
      if (tail) {
        const data = tail
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private generationConfig(options: {
    maxOutputTokens?: number;
    temperature?: number;
  }): Record<string, unknown> {
    return {
      temperature: options.temperature ?? 0.2,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      topP: 0.9,
    };
  }
}
