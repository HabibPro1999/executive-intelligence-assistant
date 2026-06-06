import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { DecksService, CreateDeckRequest } from './decks.service';

@Controller('conversations/:conversationId/decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Post()
  create(
    @Param('conversationId') conversationId: string,
    @Body() body: CreateDeckRequest,
  ) {
    return this.decks.create(conversationId, body);
  }

  @Get(':deckId/download')
  async download(
    @Param('conversationId') conversationId: string,
    @Param('deckId') deckId: string,
    @Res() res: Response,
  ) {
    const file = await this.decks.exportPptx(conversationId, deckId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.buffer);
  }
}
