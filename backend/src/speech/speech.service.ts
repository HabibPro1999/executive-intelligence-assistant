import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';

// Longest input we send to the TTS endpoint. Keeps requests bounded and avoids
// provider-side rejections for oversized payloads.
const MAX_TTS_CHARS = 4000;

const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE = 'alloy';
const TTS_FORMAT = 'mp3';

// Text-to-speech over the OpenAI audio API. Uses the SAME raw-fetch pattern and
// API key (config.ai.generation.apiKey) as embeddings/generation.
@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private readonly baseUrl = config.ai.generation.baseUrl;

  async synthesize(text: string): Promise<Buffer> {
    this.assertConfigured();
    const input = text.slice(0, MAX_TTS_CHARS);

    let res: Response;
    try {
      res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: TTS_VOICE,
          input,
          response_format: TTS_FORMAT,
        }),
      });
    } catch (err) {
      this.handleFetchError(err);
    }

    if (!res.ok) this.handleHttpError(res.status, await res.text());

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      this.logger.error('OpenAI TTS returned an empty audio body.');
      throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
    }
    return Buffer.from(arrayBuffer);
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
    return `${this.baseUrl}/audio/speech`;
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

  private handleHttpError(status: number, body: string): never {
    this.logger.error(`OpenAI TTS error ${status}: ${body.slice(0, 500)}`);
    if (status === 429) {
      throw new AppError(UserMessages.rateLimited, HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new AppError(UserMessages.llmFailed, HttpStatus.BAD_GATEWAY);
  }
}
