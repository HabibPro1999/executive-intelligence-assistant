import { Body, Controller, Param, Post } from '@nestjs/common';
import { ChatRequest, MessagesService } from './messages.service';

@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // POST /api/conversations/:conversationId/messages  (PRD §15.6)
  @Post()
  send(
    @Param('conversationId') conversationId: string,
    @Body() body: ChatRequest,
  ) {
    return this.messages.handleChat(conversationId, body);
  }
}
