import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { DocumentsService } from './documents.service';
import { config } from '../common/config';

@Controller('conversations/:conversationId/documents')
@UseGuards(SupabaseJwtGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // POST /api/conversations/:conversationId/documents  (PRD §15.4)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Hard ceiling; the service also returns a friendly PRD message.
      limits: { fileSize: config.limits.maxFileSizeMb * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(user.id, conversationId, file);
  }

  // GET /api/conversations/:conversationId/documents  (PRD §15.5)
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
  ) {
    return { documents: await this.documents.listByConversation(user.id, conversationId) };
  }

  @Get('status-summary')
  async statusSummary(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.documents.getStatusSummary(conversationId, user.id);
  }
}
