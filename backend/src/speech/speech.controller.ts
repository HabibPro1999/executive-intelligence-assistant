import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { SpeechService } from './speech.service';
import { TtsDto } from './tts.dto';

@Controller('speech')
@UseGuards(SupabaseJwtGuard)
export class SpeechController {
  constructor(private readonly speech: SpeechService) {}

  // POST /api/speech/tts — returns MP3 audio bytes for the supplied text.
  @Post('tts')
  async tts(@Body() body: TtsDto, @Res() res: Response): Promise<void> {
    const audio = await this.speech.synthesize(body.text);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audio.length);
    res.send(audio);
  }
}
