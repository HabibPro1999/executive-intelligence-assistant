import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import {
  ChatRequest,
  ChatStreamEvent,
  MessagesService,
} from './messages.service';

@Controller('conversations/:conversationId/messages')
@UseGuards(SupabaseJwtGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // POST /api/conversations/:conversationId/messages  (PRD §15.6)
  @Post()
  send(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
    @Body() body: ChatRequest,
  ) {
    return this.messages.handleChat(user.id, conversationId, body);
  }

  @Post('stream')
  async stream(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
    @Body() body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const emit = (event: ChatStreamEvent) => {
      if (res.writableEnded) return;
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await this.messages.handleChatStream(user.id, conversationId, body, emit);
    } catch (err: any) {
      emit({ type: 'error', message: this.errorMessage(err) });
    } finally {
      res.end();
    }
  }

  private errorMessage(err: any): string {
    const response = err?.response;
    const message = response?.message ?? err?.message;
    if (Array.isArray(message)) return message.join(', ');
    return message || 'The assistant could not generate a response right now.';
  }
}
