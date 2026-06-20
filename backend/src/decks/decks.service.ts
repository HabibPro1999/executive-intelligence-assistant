import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient, QueryResultRow } from 'pg';
import { config } from '../common/config';
import { UserMessages } from '../common/errors';
import {
  Confidence,
  DeckSlide,
  DeckSpec,
  DeckStyle,
  DeckSummary,
  RetrievedChunk,
  Source,
} from '../common/types';
import { ConversationsService } from '../conversations/conversations.service';
import { DatabaseService } from '../database/database.service';
import { DocumentsService } from '../documents/documents.service';
import { GenerationService } from '../generation/generation.service';
import { PreferencesService } from '../preferences/preferences.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { PptxDeckRenderer } from './pptx-deck.renderer';
import { NextGenDeckRenderer } from './nextgen-deck.renderer';

export interface CreateDeckRequest {
  message?: string;
  // Visual template. Defaults to 'classic' when omitted or invalid.
  style?: DeckStyle;
}

const DECK_STYLES: DeckStyle[] = ['classic', 'nextgen'];

function normalizeStyle(value: unknown): DeckStyle {
  return DECK_STYLES.includes(value as DeckStyle) ? (value as DeckStyle) : 'classic';
}

// In-browser preview slide shape (additive; mirrors the structured DeckSpec
// slides before pptx rendering). Lives alongside the existing DeckSummary in
// the HTTP response — does not affect pptx generation or the download route.
export interface DeckSlidePreview {
  title: string;
  subtitle?: string;
  bullets?: string[];
  kind?: string;
}

export interface CreateDeckResponse {
  messageId: string;
  answer: string;
  deck: DeckSummary | null;
  slides: DeckSlidePreview[];
  sources: Source[];
  confidence: Confidence;
  insufficient: boolean;
}

interface DeckRecord extends QueryResultRow {
  id: string;
  conversation_id: string;
  title: string;
  request: string;
  deck_spec: DeckSpec;
  source_chunk_ids: string[];
  model_name: string | null;
  created_at: string;
  updated_at: string;
}

interface DeckEvidenceSelection {
  retrieved: RetrievedChunk[];
  relevant: RetrievedChunk[];
  metadata: Record<string, unknown>;
}

@Injectable()
export class DecksService {
  private readonly logger = new Logger(DecksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsService,
    private readonly documents: DocumentsService,
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
    private readonly renderer: PptxDeckRenderer,
    private readonly nextgenRenderer: NextGenDeckRenderer,
    private readonly preferences: PreferencesService,
  ) {}

  async create(
    userId: string,
    conversationId: string,
    body: CreateDeckRequest = {},
  ): Promise<CreateDeckResponse> {
    await this.conversations.ensureExists(conversationId, userId);
    const style = normalizeStyle(body.style);
    const request =
      body.message?.trim() ||
      'Generate a strategy-consulting presentation deck from the approved documents.';
    const preferenceContext = await this.preferences.retrieveContext(userId, request);
    const userMsg = await this.addMessage(conversationId, 'user', request, {
      mode: 'strategy_deck',
      deckStyle: style,
    });

    const knowledge = await this.resolveKnowledgeConversation(userId, conversationId);
    if (knowledge.ok === false) {
      return this.refuse(conversationId, userMsg.id, knowledge.message, [], preferenceContext);
    }

    const evidence = await this.selectDeckEvidence(knowledge.conversationId, request);
    const { retrieved, relevant } = evidence;
    if (!relevant.length) {
      return this.refuse(
        conversationId,
        userMsg.id,
        UserMessages.insufficientEvidence,
        retrieved,
        preferenceContext,
      );
    }

    const confidence = this.generation.computeConfidence(relevant);
    const sources = this.generation.toSources(relevant);
    const deckSpec = await this.buildDeckSpec(request, relevant, preferenceContext);
    deckSpec.style = style; // persisted in deck_spec so the export route picks the right renderer
    const sourceChunkIds = [...new Set(relevant.map((chunk) => chunk.id))];

    const { deck, assistantMsg } = await this.db.withTransaction(async (client) => {
      const insertedDeck = await client.query<DeckRecord>(
        `insert into presentation_decks
           (conversation_id, title, request, deck_spec, source_chunk_ids, model_name)
         values ($1, $2, $3, $4::jsonb, $5::uuid[], $6)
         returning *`,
        [
          conversationId,
          deckSpec.title,
          request,
          JSON.stringify(deckSpec),
          sourceChunkIds,
          this.generation.modelName,
        ],
      );
      const deck = DatabaseService.requireRow(
        insertedDeck,
        'Deck insert returned no row.',
      );
      const summary = this.toSummary(conversationId, deck.id, deckSpec, sources, confidence);
      const assistantMsg = await this.addMessageWithClient(
        client,
        conversationId,
        'assistant',
        `Generated strategy deck: ${deckSpec.title}`,
        {
          mode: 'strategy_deck',
          deck: summary,
          sources,
          confidence,
          preferenceContext,
          ...evidence.metadata,
          ...knowledge.metadata,
        },
      );
      await this.recordDeckRun(client, {
        conversationId,
        userMessageId: userMsg.id,
        assistantMessageId: assistantMsg.id,
        chunks: relevant,
        confidence,
        modelName: this.generation.modelName,
        metadata: {
          deck_id: deck.id,
          slide_count: deckSpec.slides.length,
          ...evidence.metadata,
          ...knowledge.metadata,
        },
      });
      await this.touchWithClient(client, conversationId, request);
      return { deck, assistantMsg };
    });

    const summary = this.toSummary(conversationId, deck.id, deckSpec, sources, confidence);
    void this.preferences
      .learnFromTurn({
        userId,
        question: request,
        answer: `Generated strategy deck: ${deckSpec.title}`,
        mode: 'strategy_deck',
      })
      .catch((err) =>
        this.logger.warn(`Preference learning skipped: ${err?.message}`),
      );
    return {
      messageId: assistantMsg.id,
      answer: `Generated strategy deck: ${deckSpec.title}`,
      deck: summary,
      slides: this.mapDeckSlides(deckSpec),
      sources,
      confidence,
      insufficient: false,
    };
  }

  async exportPptx(
    userId: string,
    conversationId: string,
    deckId: string,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const row = await this.db.one<DeckRecord>(
      `select d.*
         from presentation_decks d
         join conversations c on c.id = d.conversation_id
        where d.id = $1 and d.conversation_id = $2 and c.user_id = $3`,
      [deckId, conversationId, userId],
    );
    if (!row) throw new NotFoundException('Deck not found.');
    const style = normalizeStyle(row.deck_spec?.style);
    const buffer =
      style === 'nextgen'
        ? await this.nextgenRenderer.render(row.deck_spec)
        : await this.renderer.render(row.deck_spec);
    return {
      filename: `${this.slug(row.title)}${style === 'nextgen' ? '-nextgen' : ''}.pptx`,
      buffer,
    };
  }

  private async buildDeckSpec(
    request: string,
    chunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): Promise<DeckSpec> {
    try {
      const generated = await this.generation.generateDeckSpec(
        request,
        chunks,
        preferenceContext,
      );
      return this.sanitizeDeckSpec(generated, chunks);
    } catch (err: any) {
      this.logger.error(`Deck generation failed: ${err?.message}`);
      throw new BadGatewayException(UserMessages.llmFailed);
    }
  }

  private sanitizeDeckSpec(spec: DeckSpec, chunks: RetrievedChunk[]): DeckSpec {
    if (!spec || !Array.isArray(spec.slides) || !spec.slides.length) {
      throw new Error('Deck spec missing slides.');
    }
    const validChunkIds = new Set(chunks.map((chunk) => chunk.id));
    const fallbackRefs = chunks.slice(0, 2).map((chunk) => chunk.id);
    const slides = spec.slides.slice(0, 8).map((slide, index) =>
      this.sanitizeSlide(slide, index, validChunkIds, fallbackRefs),
    );
    if (!slides.some((slide) => slide.type === 'title')) {
      slides.unshift({
        type: 'title',
        headline: this.clean(spec.title, 'Executive Strategy Briefing'),
        keyMessage: this.clean(spec.thesis, 'Document-grounded strategy synthesis.'),
        bullets: [],
        visual: { type: 'none' },
        speakerNotes: '',
        sourceRefs: [],
      });
    }
    return {
      title: this.clean(spec.title, 'Executive Strategy Briefing'),
      subtitle: this.clean(spec.subtitle, 'Document-grounded CSO briefing'),
      thesis: this.clean(spec.thesis, slides[1]?.keyMessage || slides[0].keyMessage),
      audience: 'Chief Strategy Officer',
      slides,
      sources: chunks.map((chunk) => ({
        chunkId: chunk.id,
        documentId: chunk.document_id,
        filename: chunk.filename,
        pageNumber: chunk.page_number,
        sheetName: chunk.sheet_name,
        sectionTitle: chunk.section_title,
      })),
    };
  }

  private sanitizeSlide(
    slide: DeckSlide,
    index: number,
    validChunkIds: Set<string>,
    fallbackRefs: string[],
  ): DeckSlide {
    const allowedTypes = new Set([
      'title',
      'thesis',
      'priorities',
      'opportunity',
      'benchmark',
      'performance',
      'recommendations',
      'appendix',
    ]);
    const type = allowedTypes.has(slide?.type) ? slide.type : index === 0 ? 'title' : 'thesis';
    const refs = (Array.isArray(slide?.sourceRefs) ? slide.sourceRefs : []).filter((id) =>
      validChunkIds.has(id),
    );
    return {
      type,
      headline: this.clean(slide?.headline, 'Executive insight'),
      keyMessage: this.clean(slide?.keyMessage, 'Evidence-backed strategic implication.'),
      bullets: (Array.isArray(slide?.bullets) ? slide.bullets : [])
        .map((bullet) => this.clean(bullet, ''))
        .filter(Boolean)
        .slice(0, 5),
      visual: this.sanitizeVisual(slide?.visual),
      speakerNotes: this.clean(slide?.speakerNotes, ''),
      sourceRefs: type === 'title' ? [] : refs.length ? refs : fallbackRefs,
    };
  }

  private sanitizeVisual(visual: DeckSlide['visual']): DeckSlide['visual'] {
    const type = ['none', 'callout', 'table', 'chart'].includes(visual?.type)
      ? visual.type
      : 'none';
    return {
      type,
      title: this.clean(visual?.title, ''),
      columns: Array.isArray(visual?.columns)
        ? visual.columns.map((v) => this.clean(v, '')).filter(Boolean).slice(0, 5)
        : [],
      rows: Array.isArray(visual?.rows)
        ? visual.rows
            .map((row) =>
              Array.isArray(row)
                ? row.map((v) => this.clean(String(v), '')).slice(0, 5)
                : [],
            )
            .filter((row) => row.length)
            .slice(0, 8)
        : [],
    };
  }

  private async resolveKnowledgeConversation(userId: string, conversationId: string): Promise<
    | { ok: true; conversationId: string; metadata: Record<string, unknown> }
    | { ok: false; message: string }
  > {
    const summary = await this.documents.getStatusSummary(conversationId, userId);
    if (summary.total === 0) {
      const demoId = config.demoKnowledgeConversationId;
      if (!demoId) return { ok: false, message: UserMessages.noDocuments };
      const demo = await this.documents.getStatusSummary(demoId, userId).catch(() => null);
      if (!demo?.indexed) return { ok: false, message: UserMessages.noDocuments };
      return {
        ok: true,
        conversationId: demoId,
        metadata: {
          knowledgeBase: 'demo',
          knowledgeConversationId: demoId,
        },
      };
    }
    if (summary.indexed === 0) {
      return {
        ok: false,
        message:
          summary.processing > 0
            ? UserMessages.documentsProcessing
            : UserMessages.noDocuments,
      };
    }
    return { ok: true, conversationId, metadata: {} };
  }

  private async selectDeckEvidence(
    conversationId: string,
    request: string,
  ): Promise<DeckEvidenceSelection> {
    const directRetrieved = await this.retrieval.retrieve(conversationId, request);
    const directRelevant = this.retrieval.filterRelevant(directRetrieved);
    if (directRelevant.length >= 4) {
      return {
        retrieved: directRetrieved,
        relevant: directRelevant,
        metadata: this.deckRetrievalMetadata('direct', [request], directRelevant.length),
      };
    }

    const anchors = this.deckAnchorTokens(request);
    const retrievedGroups = [directRetrieved];
    const relevantGroups = [directRelevant];
    const queries = this.deckRetrievalQueries(request);
    for (const query of queries.slice(1)) {
      const queryRetrieved = await this.retrieval.retrieve(
        conversationId,
        query,
        Math.max(config.retrieval.topK, 12),
      );
      retrievedGroups.push(queryRetrieved);
      relevantGroups.push(this.filterDeckRelevant(queryRetrieved, anchors));
    }

    const relevant = this.mergeChunks(...relevantGroups).slice(
      0,
      Math.max(config.retrieval.topK, 12),
    );
    return {
      retrieved: this.mergeChunks(...retrievedGroups),
      relevant,
      metadata: this.deckRetrievalMetadata('expanded', queries, relevant.length),
    };
  }

  private deckRetrievalQueries(request: string): string[] {
    return [
      request,
      'executive summary financial highlights business model product overview market opportunity risks recommendations KPIs',
      'revenue growth EBITDA gross margin cash flow scenarios risk register management actions',
      'company profile investment view strategic priorities opportunity analysis performance insights',
    ].filter((query, index, queries) => queries.findIndex((q) => q === query) === index);
  }

  private filterDeckRelevant(
    chunks: RetrievedChunk[],
    anchors: string[],
  ): RetrievedChunk[] {
    const strict = this.retrieval.filterRelevant(chunks);
    if (strict.length) return strict;

    const candidates = chunks.filter(
      (chunk) => chunk.similarity >= this.deckSimilarityThreshold(),
    );
    if (!anchors.length) return candidates;
    return candidates.filter((chunk) => this.chunkMatchesAnchor(chunk, anchors));
  }

  private deckSimilarityThreshold(): number {
    return Math.min(config.retrieval.similarityThreshold, 0.35);
  }

  private deckAnchorTokens(text: string): string[] {
    const stop = new Set([
      'approved',
      'based',
      'consulting',
      'deck',
      'document',
      'documents',
      'from',
      'generate',
      'presentation',
      'strategy',
      'uploaded',
    ]);
    const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]{1,}/gu) ?? [];
    const anchors = tokens.filter((token) => {
      const normalized = this.normalizeToken(token);
      if (normalized.length < 3 || stop.has(normalized)) return false;
      return (
        /[A-Z]{2,}/.test(token) ||
        /[a-z][A-Z]/.test(token) ||
        /^[A-Z][a-z]{2,}$/.test(token) ||
        /\d/.test(token)
      );
    });
    return [...new Set(anchors.map((token) => this.normalizeToken(token)))];
  }

  private chunkMatchesAnchor(chunk: RetrievedChunk, anchors: string[]): boolean {
    const haystack = this.normalizeToken(
      `${chunk.filename} ${chunk.source_title ?? ''} ${chunk.content}`,
    );
    return anchors.some((anchor) => haystack.includes(anchor));
  }

  private normalizeToken(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .toLowerCase();
  }

  private deckRetrievalMetadata(
    strategy: 'direct' | 'expanded',
    queries: string[],
    chunkCount: number,
  ): Record<string, unknown> {
    return {
      retrieval_strategy: strategy,
      generated_queries: queries,
      expanded_chunk_count: chunkCount,
    };
  }

  private async refuse(
    conversationId: string,
    userMessageId: string,
    text: string,
    retrieved: RetrievedChunk[] = [],
    preferenceContext?: string | null,
  ): Promise<CreateDeckResponse> {
    const answer = this.styleRefusal(text, preferenceContext);
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addMessageWithClient(
        client,
        conversationId,
        'assistant',
        answer,
        {
          mode: 'strategy_deck',
          deck: null,
          sources: [],
          confidence: 'low',
          insufficient: true,
          preferenceContext,
        },
      );
      await this.recordDeckRun(client, {
        conversationId,
        userMessageId,
        assistantMessageId: msg.id,
        chunks: retrieved,
        confidence: 'low',
        modelName: null,
        metadata: { insufficient: true },
      });
      await this.touchWithClient(client, conversationId);
      return msg;
    });
    return {
      messageId: assistantMsg.id,
      answer,
      deck: null,
      slides: [],
      sources: [],
      confidence: 'low',
      insufficient: true,
    };
  }

  private styleRefusal(text: string, preferenceContext?: string | null): string {
    if (!preferenceContext) return text;
    if (!/arabic|العربية|عربي/i.test(preferenceContext)) return text;
    if (text === UserMessages.noDocuments) {
      return 'لا توجد مستندات معتمدة في هذه المحادثة حتى الآن. يرجى تحميل مستندات ذات صلة كي أنشئ عرضا بناء عليها فقط.';
    }
    if (text === UserMessages.documentsProcessing) {
      return 'ما زالت المستندات قيد الفهرسة. يرجى المحاولة مرة أخرى بعد اكتمال المعالجة.';
    }
    if (text === UserMessages.insufficientEvidence) {
      return 'لا تتضمن المستندات المعتمدة أدلة كافية لإنشاء هذا العرض بثقة. يرجى تحميل مصدر ذي صلة أو تضييق نطاق الطلب.';
    }
    return text;
  }

  private async addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db.oneOrThrow(
      `insert into messages (conversation_id, role, content, metadata)
       values ($1, $2, $3, $4::jsonb) returning *`,
      [conversationId, role, content, JSON.stringify(metadata)],
      'Message insert returned no row.',
    );
  }

  private async addMessageWithClient(
    client: PoolClient,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata: Record<string, unknown>,
  ) {
    const result = await client.query(
      `insert into messages (conversation_id, role, content, metadata)
       values ($1, $2, $3, $4::jsonb) returning *`,
      [conversationId, role, content, JSON.stringify(metadata)],
    );
    return DatabaseService.requireRow(result, 'Message insert returned no row.');
  }

  private async recordDeckRun(
    client: PoolClient,
    input: {
      conversationId: string;
      userMessageId: string;
      assistantMessageId: string;
      chunks: RetrievedChunk[];
      confidence: Confidence;
      modelName: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const chunkIds = input.chunks.map((chunk) => chunk.id);
    const documentIds = [...new Set(input.chunks.map((chunk) => chunk.document_id))];
    await client.query(
      `insert into assistant_runs
         (conversation_id, user_message_id, assistant_message_id, mode, model_name,
          retrieved_chunk_ids, retrieved_document_ids, confidence, metadata)
       values ($1, $2, $3, 'strategy_deck', $4, $5::uuid[], $6::uuid[], $7, $8::jsonb)`,
      [
        input.conversationId,
        input.userMessageId,
        input.assistantMessageId,
        input.modelName,
        chunkIds,
        documentIds,
        input.confidence,
        JSON.stringify({ chunk_count: chunkIds.length, ...input.metadata }),
      ],
    );
  }

  private async touchWithClient(
    client: PoolClient,
    id: string,
    candidateTitle?: string,
  ): Promise<void> {
    if (candidateTitle) {
      const title = candidateTitle.trim().slice(0, 80);
      await client.query(
        `update conversations
            set updated_at = now(),
                title = coalesce(title, $2)
          where id = $1`,
        [id, title],
      );
      return;
    }
    await client.query(`update conversations set updated_at = now() where id = $1`, [
      id,
    ]);
  }

  private toSummary(
    conversationId: string,
    deckId: string,
    spec: DeckSpec,
    sources: Source[],
    confidence: Confidence,
  ): DeckSummary {
    return {
      deckId,
      title: spec.title,
      thesis: spec.thesis,
      slides: spec.slides.map((slide) => ({
        type: slide.type,
        headline: slide.headline,
        keyMessage: slide.keyMessage,
      })),
      sources,
      confidence,
      insufficient: false,
      style: normalizeStyle(spec.style),
      downloadUrl: `/api/conversations/${conversationId}/decks/${deckId}/download`,
    };
  }

  // Best-effort map of the structured DeckSpec slides into the lightweight
  // preview shape used for in-browser rendering. Purely additive; never throws.
  private mapDeckSlides(spec: DeckSpec): DeckSlidePreview[] {
    if (!spec || !Array.isArray(spec.slides)) return [];
    return spec.slides.map((slide) => {
      const preview: DeckSlidePreview = {
        title: this.clean(slide?.headline, 'Executive insight'),
        kind: slide?.type,
      };
      const subtitle = this.clean(slide?.keyMessage, '');
      if (subtitle) preview.subtitle = subtitle;
      const bullets = (Array.isArray(slide?.bullets) ? slide.bullets : [])
        .map((bullet) => this.clean(bullet, ''))
        .filter(Boolean);
      if (bullets.length) preview.bullets = bullets;
      return preview;
    });
  }

  private clean(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned || fallback;
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'strategy-deck'
    );
  }

  private mergeChunks(...groups: RetrievedChunk[][]): RetrievedChunk[] {
    const seen = new Set<string>();
    const merged: RetrievedChunk[] = [];
    for (const chunk of groups.flat()) {
      if (seen.has(chunk.id)) continue;
      seen.add(chunk.id);
      merged.push(chunk);
    }
    return merged.sort((a, b) => b.similarity - a.similarity);
  }
}
