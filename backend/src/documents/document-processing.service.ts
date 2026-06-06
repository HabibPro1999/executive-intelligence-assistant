import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ExtractionService } from '../extraction/extraction.service';
import { ChunkingService } from '../chunking/chunking.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { SupabaseService } from '../supabase/supabase.service';
import { config, SupportedFileType } from '../common/config';
import { UserMessages } from '../common/errors';
import { ContentChunk, DocumentRecord } from '../common/types';

// Runs the upload -> index pipeline (PRD §17.1) for a single document.
// All failures are caught and reflected as document status = 'failed'.
@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly extraction: ExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
    private readonly supabase: SupabaseService,
  ) {}

  async process(
    doc: DocumentRecord,
    buffer: Buffer,
    fileType: SupportedFileType,
  ): Promise<void> {
    this.logger.log(`Processing document ${doc.id} (${doc.filename})`);
    try {
      // 1. Extract -------------------------------------------------------
      const extraction = await this.extraction.extract(fileType, buffer);
      await this.db.query(
        `update documents set page_count = $2, sheet_count = $3, updated_at = now() where id = $1`,
        [doc.id, extraction.page_count ?? null, extraction.sheet_count ?? null],
      );
      if (!extraction.segments.length) {
        return this.fail(doc, UserMessages.extractionFailed);
      }

      // 2. Chunk ---------------------------------------------------------
      let chunks = this.chunking.chunk(extraction.segments);
      if (!chunks.length) {
        return this.fail(doc, UserMessages.extractionFailed);
      }

      // 2b. Pre-check the per-conversation chunk budget to skip wasted
      // embedding work when the conversation is already full (demo safety, §17.3).
      const max = config.limits.maxChunksPerConversation;
      const preUsed = await this.db.one<{ count: string }>(
        `select count(*)::int as count from document_chunks where conversation_id = $1`,
        [doc.conversation_id],
      );
      if (max - Number(preUsed?.count ?? 0) <= 0) {
        return this.fail(doc, UserMessages.chunkBudgetExceeded);
      }

      // 3. Embed ---------------------------------------------------------
      const vectors = await this.embeddings.embedDocuments(
        chunks.map((c) => c.content),
      );
      if (vectors.length !== chunks.length) {
        return this.fail(doc, UserMessages.embeddingFailed);
      }

      // 4. Store chunks + vectors atomically -----------------------------
      // A per-conversation advisory lock serializes the authoritative
      // count + insert so concurrent uploads can't exceed the budget.
      const insertedCount = await this.db.withTransaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [
          doc.conversation_id,
        ]);
        const cur = await client.query(
          `select count(*)::int as count from document_chunks where conversation_id = $1`,
          [doc.conversation_id],
        );
        const remaining = max - Number(cur.rows[0]?.count ?? 0);
        if (remaining <= 0) return 0;
        const finalChunks = chunks.slice(0, remaining);
        const finalVectors = vectors.slice(0, remaining);
        if (finalChunks.length < chunks.length) {
          this.logger.warn(
            `Truncating document ${doc.id} from ${chunks.length} to ${finalChunks.length} chunks (budget).`,
          );
        }
        await this.insertChunks(client, doc, finalChunks, finalVectors);
        return finalChunks.length;
      });
      if (insertedCount === 0) {
        return this.fail(doc, UserMessages.chunkBudgetExceeded);
      }

      // 5. Mark indexed --------------------------------------------------
      await this.db.query(
        `update documents set status = 'indexed', error_message = null, updated_at = now() where id = $1`,
        [doc.id],
      );
      this.logger.log(
        `Indexed document ${doc.id}: ${insertedCount} chunks stored.`,
      );
    } catch (err: any) {
      this.logger.error(`Processing failed for ${doc.id}: ${err?.message}`);
      const message =
        err?.response?.message ?? UserMessages.embeddingFailed;
      await this.fail(doc, message);
    }
  }

  private async fail(doc: DocumentRecord, message: string): Promise<void> {
    let storageDeleted = false;
    if (doc.storage_path) {
      try {
        await this.supabase.deleteFile(doc.storage_path);
        storageDeleted = true;
      } catch (err: any) {
        this.logger.error(
          `Storage cleanup failed for document ${doc.id}: ${err?.message}`,
        );
      }
    }
    await this.db.query(
      `update documents
          set status = 'failed',
              storage_path = case when $3 then '' else storage_path end,
              error_message = $2,
              updated_at = now()
        where id = $1`,
      [doc.id, message, storageDeleted],
    );
  }

  private async insertChunks(
    client: PoolClient,
    doc: DocumentRecord,
    chunks: ContentChunk[],
    vectors: number[][],
  ): Promise<void> {
    if (chunks.length === 0) return;
    const cols = 10;
    const values: unknown[] = [];
    const rows: string[] = [];

    chunks.forEach((chunk, i) => {
      const base = i * cols;
      rows.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10}::vector)`,
      );
      values.push(
        doc.id,
        doc.conversation_id,
        chunk.chunk_index,
        chunk.content,
        chunk.page_number ?? null,
        chunk.sheet_name ?? null,
        chunk.section_title ?? null,
        chunk.token_count,
        JSON.stringify(chunk.metadata ?? {}),
        DatabaseService.toVectorLiteral(vectors[i]),
      );
    });

    await client.query(
      `insert into document_chunks
         (document_id, conversation_id, chunk_index, content, page_number,
          sheet_name, section_title, token_count, metadata, embedding)
       values ${rows.join(', ')}`,
      values,
    );
  }
}
