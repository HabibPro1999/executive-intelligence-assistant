import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { config } from '../common/config';
import { RetrievedChunk, SourceType } from '../common/types';

// Finds the most relevant chunks for a query, scoped to one conversation and
// to indexed + approved documents only (data isolation, PRD §21.2).
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async retrieve(
    conversationId: string,
    query: string,
    topK: number = config.retrieval.topK,
    sourceTypes: SourceType[] = ['uploaded_document'],
  ): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    const literal = DatabaseService.toVectorLiteral(queryEmbedding);
    // match_document_chunks.p_match_count is an int / SQL LIMIT — coerce so a
    // non-integer TOP_K_CHUNKS env value can never throw at query time.
    const limit = Math.max(1, Math.trunc(topK));

    const rows = await this.db.rows<RetrievedChunk>(
      `select id, document_id, conversation_id, chunk_index, content,
              page_number, sheet_name, section_title, filename, file_type,
              source_type, source_url, source_title, retrieved_at, similarity
         from match_document_chunks($1, $2::vector, $3, $4::text[])`,
      [conversationId, literal, limit, sourceTypes],
    );

    this.logger.log(
      `Retrieved ${rows.length} chunks for conversation ${conversationId} ` +
        `(top similarity ${rows[0]?.similarity?.toFixed(3) ?? 'n/a'})`,
    );
    return rows;
  }

  // Chunks that clear the relevance threshold are treated as usable evidence.
  filterRelevant(chunks: RetrievedChunk[]): RetrievedChunk[] {
    return chunks.filter(
      (c) => c.similarity >= config.retrieval.similarityThreshold,
    );
  }
}
