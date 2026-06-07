import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { DecksService, CreateDeckRequest } from './decks.service';

@Controller('conversations/:conversationId/decks')
@UseGuards(SupabaseJwtGuard)
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Post()
create(
@CurrentUser() user: AuthUser,
@Param('conversationId') conversationId: string,
@Body() body: CreateDeckRequest,
) {
return this.decks.create(user.id, conversationId, body);
}

  @Get(':deckId/download')
async download(
@CurrentUser() user: AuthUser,
@Param('conversationId') conversationId: string,
@Param('deckId') deckId: string,
@Res() res: Response,
) {
const file = await this.decks.exportPptx(user.id, conversationId, deckId);
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
