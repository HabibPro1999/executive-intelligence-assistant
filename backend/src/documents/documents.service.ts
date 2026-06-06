import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SupabaseService } from '../supabase/supabase.service';
import { ConversationsService } from '../conversations/conversations.service';
import { DocumentProcessingService } from './document-processing.service';
import { config, SUPPORTED_FILE_TYPES, SupportedFileType } from '../common/config';
import {
  FileTooLargeError,
  TooManyFilesError,
  UnsupportedFileTypeError,
} from '../common/errors';
import { DocumentRecord, DocumentStatus } from '../common/types';

export interface UploadResult {
  documentId: string;
  filename: string;
  status: DocumentStatus;
}

export interface DocumentStatusSummary {
  total: number;
  indexed: number;
  processing: number;
  failed: number;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly supabase: SupabaseService,
    private readonly conversations: ConversationsService,
    private readonly processing: DocumentProcessingService,
  ) {}

  private detectFileType(filename: string): SupportedFileType {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_FILE_TYPES.includes(ext as SupportedFileType)) {
      throw new UnsupportedFileTypeError();
    }
    return ext as SupportedFileType;
  }

  async upload(
    conversationId: string,
    file: Express.Multer.File,
  ): Promise<UploadResult> {
    await this.conversations.ensureExists(conversationId);

    if (!file) throw new UnsupportedFileTypeError();
    const fileType = this.detectFileType(file.originalname);

    const maxBytes = config.limits.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) throw new FileTooLargeError();

    const doc = await this.db.withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        conversationId,
      ]);
      const existing = await client.query<{ count: string }>(
        `select count(*)::int as count from documents
          where conversation_id = $1 and status <> 'failed'`,
        [conversationId],
      );
      if (
        Number(existing.rows[0]?.count ?? 0) >=
        config.limits.maxFilesPerConversation
      ) {
        throw new TooManyFilesError();
      }
      const inserted = await client.query<DocumentRecord>(
        `insert into documents (conversation_id, filename, file_type, storage_path, status)
         values ($1, $2, $3, '', 'uploaded') returning *`,
        [conversationId, file.originalname, fileType],
      );
      return DatabaseService.requireRow(
        inserted,
        'Document insert returned no row.',
      );
    });

    let storagePath: string;
    try {
      storagePath = await this.supabase.uploadFile(
        conversationId,
        doc.id,
        file.originalname,
        file.buffer,
        file.mimetype || 'application/octet-stream',
      );
    } catch (err) {
      await this.updateStatus(doc.id, 'failed', {
        error_message: 'File storage failed.',
      });
      throw err;
    }

    try {
      await this.db.query(
        `update documents set storage_path = $2, status = 'processing', updated_at = now() where id = $1`,
        [doc.id, storagePath],
      );
    } catch (err) {
      await this.supabase.deleteFile(storagePath).catch((cleanupErr) =>
        this.logger.error(
          `Storage cleanup failed for ${doc.id}: ${cleanupErr?.message}`,
        ),
      );
      await this.updateStatus(doc.id, 'failed', {
        error_message: 'File storage failed.',
      }).catch((statusErr) =>
        this.logger.error(
          `Failed to mark document ${doc.id} failed: ${statusErr?.message}`,
        ),
      );
      throw err;
    }

    // Process asynchronously so the upload responds quickly (PRD §23 perf).
    // Failures are captured inside the processing service (status -> failed).
    void this.processing
      .process({ ...doc, storage_path: storagePath }, file.buffer, fileType)
      .catch((err) =>
        this.logger.error(
          `Unhandled processing error for document ${doc.id}: ${err?.message}`,
        ),
      );

    return { documentId: doc.id, filename: doc.filename, status: 'processing' };
  }

  async listByConversation(conversationId: string): Promise<DocumentRecord[]> {
    await this.conversations.ensureExists(conversationId);
    return this.db.rows<DocumentRecord>(
      `select * from documents where conversation_id = $1 order by created_at asc`,
      [conversationId],
    );
  }

  async getStatusSummary(conversationId: string): Promise<DocumentStatusSummary> {
    const row = await this.db.one<{
      total: string;
      indexed: string;
      processing: string;
      failed: string;
    }>(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'indexed' and approval_status = 'approved')::int as indexed,
         count(*) filter (where status in ('uploaded', 'processing'))::int as processing,
         count(*) filter (where status = 'failed')::int as failed
       from documents where conversation_id = $1`,
      [conversationId],
    );
    return {
      total: Number(row?.total ?? 0),
      indexed: Number(row?.indexed ?? 0),
      processing: Number(row?.processing ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    fields: Partial<
      Pick<DocumentRecord, 'error_message' | 'page_count' | 'sheet_count'>
    > = {},
  ): Promise<void> {
    await this.db.query(
      `update documents
          set status = $2,
              error_message = $3,
              page_count = coalesce($4, page_count),
              sheet_count = coalesce($5, sheet_count),
              updated_at = now()
        where id = $1`,
      [
        id,
        status,
        fields.error_message ?? null,
        fields.page_count ?? null,
        fields.sheet_count ?? null,
      ],
    );
  }
}
