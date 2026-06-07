import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ChunkingService } from '../chunking/chunking.service';
import { config } from '../common/config';
import {
  Confidence,
  ContentChunk,
  RetrievedChunk,
  Source,
} from '../common/types';
import { DatabaseService } from '../database/database.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { GenerationService } from '../generation/generation.service';
import { GeminiGroundingMetadata } from '../generation/gemini-generation.provider';

interface WebSource {
  title: string;
  url: string;
  domain: string | null;
  retrievedAt: string;
}

interface WebFinding {
  title: string;
  summary: string;
  category: 'competitor' | 'market_news' | 'regulatory' | 'financial' | 'other';
  entities: string[];
  timeScope: string | null;
  sourceUrls: string[];
  sourceTitles: string[];
  retrievedAt: string;
}

export interface WebResearchResult {
  answer: string;
  sources: Source[];
  confidence: Confidence;
  savedChunks: RetrievedChunk[];
  metadata: {
    webSearchQueries: string[];
    sourceCount: number;
    savedToRag: boolean;
  };
}

@Injectable()
export class WebResearchService {
  private readonly logger = new Logger(WebResearchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly generation: GenerationService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async research(input: {
    conversationId: string;
    question: string;
    contextChunks: RetrievedChunk[];
    preferenceContext?: string | null;
  }): Promise<WebResearchResult> {
    const generated = await this.generation.generateWebResearch(
      input.question,
      input.contextChunks,
      input.preferenceContext,
    );
    const retrievedAt = new Date().toISOString();
    const webSources = this.extractSources(generated.groundingMetadata, retrievedAt);
    const webSearchQueries = generated.groundingMetadata?.webSearchQueries ?? [];
    let savedChunks: RetrievedChunk[] = [];

    if (webSources.length) {
      try {
        savedChunks = await this.saveFinding({
          conversationId: input.conversationId,
          question: input.question,
          answer: generated.text,
          sources: webSources,
          webSearchQueries,
          groundingMetadata: generated.groundingMetadata,
          retrievedAt,
        });
      } catch (err: any) {
        this.logger.warn(`Web finding was not saved to RAG: ${err?.message}`);
      }
    }

    return {
      answer: generated.text,
      sources: this.toSources(webSources),
      confidence: this.confidence(webSources),
      savedChunks,
      metadata: {
        webSearchQueries,
        sourceCount: webSources.length,
        savedToRag: savedChunks.length > 0,
      },
    };
  }

  async researchStream(
    input: {
      conversationId: string;
      question: string;
      contextChunks: RetrievedChunk[];
      preferenceContext?: string | null;
    },
    onDelta: (text: string) => void,
    onStatus?: (label: string) => void,
  ): Promise<WebResearchResult> {
    let answer = '';
    let groundingMetadata: GeminiGroundingMetadata | undefined;
    for await (const chunk of this.generation.streamWebResearch(
      input.question,
      input.contextChunks,
      input.preferenceContext,
    )) {
      if (chunk.text) {
        answer += chunk.text;
        onDelta(chunk.text);
      }
      if (chunk.groundingMetadata) groundingMetadata = chunk.groundingMetadata;
    }

    const retrievedAt = new Date().toISOString();
    onStatus?.('Checking citations');
    const webSources = this.extractSources(groundingMetadata, retrievedAt);
    const webSearchQueries = groundingMetadata?.webSearchQueries ?? [];
    let savedChunks: RetrievedChunk[] = [];

    if (webSources.length) {
      try {
        onStatus?.('Saving web findings');
        savedChunks = await this.saveFinding({
          conversationId: input.conversationId,
          question: input.question,
          answer,
          sources: webSources,
          webSearchQueries,
          groundingMetadata,
          retrievedAt,
        });
      } catch (err: any) {
        this.logger.warn(`Web finding was not saved to RAG: ${err?.message}`);
      }
    }

    return {
      answer,
      sources: this.toSources(webSources),
      confidence: this.confidence(webSources),
      savedChunks,
      metadata: {
        webSearchQueries,
        sourceCount: webSources.length,
        savedToRag: savedChunks.length > 0,
      },
    };
  }

  private extractSources(
    metadata: GeminiGroundingMetadata | undefined,
    retrievedAt: string,
  ): WebSource[] {
    const seen = new Set<string>();
    const out: WebSource[] = [];
    for (const chunk of metadata?.groundingChunks ?? []) {
      const url = chunk.web?.uri?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: chunk.web?.title?.trim() || this.hostname(url) || url,
        url,
        domain: this.hostname(url),
        retrievedAt,
      });
    }
    return out;
  }

  private async saveFinding(input: {
    conversationId: string;
    question: string;
    answer: string;
    sources: WebSource[];
    webSearchQueries: string[];
    groundingMetadata?: GeminiGroundingMetadata;
    retrievedAt: string;
  }): Promise<RetrievedChunk[]> {
    const finding = this.toFinding(input);
    const content = this.findingContent(input.question, input.answer, finding);
    const chunks = this.chunking.chunk([
      {
        content,
        section_title: 'Web Research',
        metadata: {
          sourceType: 'web_research',
          sourceUrl: input.sources[0]?.url ?? null,
          sourceTitle: input.sources[0]?.title ?? finding.title,
          retrievedAt: input.retrievedAt,
          sourceUrls: finding.sourceUrls,
          sourceTitles: finding.sourceTitles,
          webSearchQueries: input.webSearchQueries,
        },
      },
    ]);
    if (!chunks.length) return [];

    const vectors = await this.embeddings.embedDocuments(
      chunks.map((chunk) => chunk.content),
    );
    if (vectors.length !== chunks.length) return [];

    return this.db.withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        input.conversationId,
      ]);
      const used = await client.query<{ count: string }>(
        `select count(*)::int as count from document_chunks where conversation_id = $1`,
        [input.conversationId],
      );
      const remaining =
        config.limits.maxChunksPerConversation - Number(used.rows[0]?.count ?? 0);
      if (remaining <= 0) return [];

      const finalChunks = chunks.slice(0, remaining);
      const finalVectors = vectors.slice(0, remaining);
      const doc = await client.query<{ id: string }>(
        `insert into documents
           (conversation_id, filename, file_type, storage_path, status,
            approval_status, source_type, metadata)
         values ($1, $2, 'web', $3, 'indexed', 'approved', 'web_research', $4::jsonb)
         returning id`,
        [
          input.conversationId,
          this.filename(input.question),
          `web://research/${Date.now()}-${this.hash(input.question)}`,
          JSON.stringify({
            query: input.question,
            retrievedAt: input.retrievedAt,
            category: finding.category,
            entities: finding.entities,
            sourceUrls: finding.sourceUrls,
            sourceTitles: finding.sourceTitles,
            webSearchQueries: input.webSearchQueries,
            grounding: {
              groundingChunkCount:
                input.groundingMetadata?.groundingChunks?.length ?? 0,
              groundingSupportCount:
                input.groundingMetadata?.groundingSupports?.length ?? 0,
            },
          }),
        ],
      );
      const documentId = DatabaseService.requireRow(
        doc,
        'Web research document insert returned no row.',
      ).id;
      await this.insertChunks(
        client,
        documentId,
        input.conversationId,
        finalChunks,
        finalVectors,
      );
      return this.selectDocumentChunks(client, documentId);
    });
  }

  private async insertChunks(
    client: PoolClient,
    documentId: string,
    conversationId: string,
    chunks: ContentChunk[],
    vectors: number[][],
  ): Promise<void> {
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
        documentId,
        conversationId,
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

  private async selectDocumentChunks(
    client: PoolClient,
    documentId: string,
  ): Promise<RetrievedChunk[]> {
    const result = await client.query<RetrievedChunk>(
      `select c.id, c.document_id, c.conversation_id, c.chunk_index, c.content,
              c.page_number, c.sheet_name, c.section_title, d.filename, d.file_type,
              d.source_type,
              coalesce(c.metadata->>'sourceUrl', d.metadata->>'sourceUrl') as source_url,
              coalesce(c.metadata->>'sourceTitle', d.metadata->>'sourceTitle', d.filename) as source_title,
              coalesce(c.metadata->>'retrievedAt', d.metadata->>'retrievedAt') as retrieved_at,
              1::float as similarity
         from document_chunks c
         join documents d on d.id = c.document_id
        where c.document_id = $1
        order by c.chunk_index`,
      [documentId],
    );
    return result.rows;
  }

  private toSources(sources: WebSource[]): Source[] {
    return sources.map((source, index) => ({
      documentId: null,
      filename: source.title,
      pageNumber: null,
      sheetName: null,
      sectionTitle: source.domain,
      chunkId: `web-${index}-${this.hash(source.url)}`,
      sourceType: 'web_research',
      url: source.url,
      domain: source.domain,
      retrievedAt: source.retrievedAt,
    }));
  }

  private toFinding(input: {
    question: string;
    answer: string;
    sources: WebSource[];
    retrievedAt: string;
  }): WebFinding {
    return {
      title: input.question.slice(0, 120),
      summary: input.answer.slice(0, 2000),
      category: this.category(input.question),
      entities: this.entities(input.question),
      timeScope: this.timeScope(input.question),
      sourceUrls: input.sources.map((source) => source.url),
      sourceTitles: input.sources.map((source) => source.title),
      retrievedAt: input.retrievedAt,
    };
  }

  private findingContent(
    question: string,
    answer: string,
    finding: WebFinding,
  ): string {
    return [
      `Web research query: ${question}`,
      `Category: ${finding.category}`,
      `Time scope: ${finding.timeScope ?? 'not specified'}`,
      `Retrieved at: ${finding.retrievedAt}`,
      '',
      'Curated answer:',
      answer,
      '',
      'Sources:',
      ...finding.sourceUrls.map(
        (url, i) => `- ${finding.sourceTitles[i] || url}: ${url}`,
      ),
    ].join('\n');
  }

  private confidence(sources: WebSource[]): Confidence {
    if (sources.length >= 3) return 'high';
    if (sources.length >= 1) return 'medium';
    return 'low';
  }

  private category(query: string): WebFinding['category'] {
    if (/competitor|rival|competing/i.test(query)) return 'competitor';
    if (/regulat|policy|law|legislation/i.test(query)) return 'regulatory';
    if (/financial|market|stock|capital|funding|earnings/i.test(query)) {
      return 'financial';
    }
    if (/news|yesterday|today|recent|latest/i.test(query)) return 'market_news';
    return 'other';
  }

  private timeScope(query: string): string | null {
    if (/yesterday/i.test(query)) return 'yesterday';
    if (/today/i.test(query)) return 'today';
    if (/last\s+week/i.test(query)) return 'last week';
    if (/recent|latest/i.test(query)) return 'recent';
    return null;
  }

  private entities(query: string): string[] {
    const matches = query.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\b/g);
    return [...new Set(matches ?? [])].slice(0, 8);
  }

  private filename(query: string): string {
    const short = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70);
    return `Web research: ${short || 'live-intelligence'}`;
  }

  private hostname(value: string): string | null {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  private hash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }
}
