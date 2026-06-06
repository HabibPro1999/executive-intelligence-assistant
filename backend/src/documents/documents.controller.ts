import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { config } from '../common/config';

@Controller('conversations/:conversationId/documents')
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
    @Param('conversationId') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documents.upload(conversationId, file);
  }

  // GET /api/conversations/:conversationId/documents  (PRD §15.5)
  @Get()
  async list(@Param('conversationId') conversationId: string) {
    return { documents: await this.documents.listByConversation(conversationId) };
  }

  @Get('status-summary')
  async statusSummary(@Param('conversationId') conversationId: string) {
    return this.documents.getStatusSummary(conversationId);
  }
}
