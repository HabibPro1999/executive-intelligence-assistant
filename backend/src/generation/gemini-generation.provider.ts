import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/';

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
          generationConfig: {
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxOutputTokens ?? 2048,
            topP: 0.9,
          },
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
    return text;
  }
}
