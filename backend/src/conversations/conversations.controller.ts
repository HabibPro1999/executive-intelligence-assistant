import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
@UseGuards(SupabaseJwtGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  // POST /api/conversations  (PRD §15.1)
  @Post()
  async create(@CurrentUser() user: AuthUser): Promise<{ conversationId: string }> {
    const conversation = await this.conversations.create(user.id);
    return { conversationId: conversation.id };
  }

  // GET /api/conversations  (PRD §15.2) — recent anonymous conversations.
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { conversations: await this.conversations.listRecent(user.id) };
  }

  // GET /api/conversations/:id  (PRD §15.3)
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.getFull(id, user.id);
  }
}
