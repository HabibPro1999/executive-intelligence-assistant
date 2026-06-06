import { Controller, Get, Param, Post } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  // POST /api/conversations  (PRD §15.1)
  @Post()
  async create(): Promise<{ conversationId: string }> {
    const conversation = await this.conversations.create();
    return { conversationId: conversation.id };
  }

  // GET /api/conversations  (PRD §15.2) — recent anonymous conversations.
  @Get()
  async list() {
    return { conversations: await this.conversations.listRecent() };
  }

  // GET /api/conversations/:id  (PRD §15.3)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.conversations.getFull(id);
  }
}
