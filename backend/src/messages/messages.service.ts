import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ConversationsService } from '../conversations/conversations.service';
import {
  DocumentStatusSummary,
  DocumentsService,
} from '../documents/documents.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { GenerationService } from '../generation/generation.service';
import { PreferencesService } from '../preferences/preferences.service';
import { WebResearchService } from '../web-research/web-research.service';
import { MODE_DEFAULT_MESSAGE } from '../generation/prompt-templates';
import { config } from '../common/config';
import { AppError, UserMessages } from '../common/errors';
import {
  ASSISTANT_MODES,
  AssistantMode,
  Confidence,
  Message,
  MessageRole,
  RetrievedChunk,
  Source,
} from '../common/types';
import { HttpStatus } from '@nestjs/common';

export interface ChatRequest {
  message?: string;
  mode?: string;
}

export interface ChatResponse {
  messageId: string;
  answer: string;
  sources: Source[];
  confidence: Confidence;
  insufficient: boolean;
}

export type ChatStreamEvent =
  | { type: 'message'; messageId: string; mode: AssistantMode }
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | {
      type: 'sources';
      sources: Source[];
      confidence: Confidence;
      insufficient: boolean;
    }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export type ChatStreamEmit = (event: ChatStreamEvent) => void;

interface EvidenceSelection {
  retrieved: RetrievedChunk[];
  relevant: RetrievedChunk[];
  inferred: boolean;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsService,
    private readonly documents: DocumentsService,
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
    private readonly preferences: PreferencesService,
    private readonly webResearch: WebResearchService,
  ) {}

  async add(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    return this.db.oneOrThrow<Message>(
      `insert into messages (conversation_id, role, content, metadata)
       values ($1, $2, $3, $4::jsonb) returning *`,
      [conversationId, role, content, JSON.stringify(metadata)],
      'Message insert returned no row.',
    );
  }

  // Orchestrates the RAG chat flow (PRD §9.3 / §15.6).
  async handleChat(
    userId: string,
    conversationId: string,
    body: ChatRequest,
  ): Promise<ChatResponse> {
    await this.conversations.ensureExists(conversationId, userId);

    const mode: AssistantMode = ASSISTANT_MODES.includes(body.mode as AssistantMode)
      ? (body.mode as AssistantMode)
      : 'qa';
    const question = (body.message?.trim() || MODE_DEFAULT_MESSAGE[mode]).trim();
    if (!question) {
      throw new AppError('A message is required.', HttpStatus.BAD_REQUEST);
    }

    const userMsg = await this.add(conversationId, 'user', question, { mode });
    const preferenceContext = await this.preferences.retrieveContext(userId, question);

    if (mode === 'web_research') {
      if (!config.ai.webResearchEnabled) {
        return this.refuse(
          conversationId,
          userMsg.id,
          mode,
          UserMessages.webResearchDisabled,
          [],
          preferenceContext,
        );
      }
      return this.handleWebResearch({
        userId,
        conversationId,
        userMessageId: userMsg.id,
        question,
        preferenceContext,
      });
    }

    // Guard: documents must exist and be indexed before answering. Empty
    // conversations may fall back to a configured demo knowledge base.
    const summary = await this.documents.getStatusSummary(conversationId, userId);
    let knowledgeConversationId = conversationId;
    let knowledgeMetadata: Record<string, unknown> = {};
    if (summary.total === 0) {
      const demo = await this.getDemoKnowledge(userId);
      if (!demo) {
        return this.refuse(
          conversationId,
          userMsg.id,
          mode,
          UserMessages.noDocuments,
          [],
          preferenceContext,
        );
      }
      knowledgeConversationId = demo.conversationId;
      knowledgeMetadata = {
        knowledgeBase: 'demo',
        knowledgeConversationId,
      };
    }
    if (summary.total > 0 && summary.indexed === 0) {
      const text =
        summary.processing > 0
          ? UserMessages.documentsProcessing
          : UserMessages.noDocuments;
      return this.refuse(conversationId, userMsg.id, mode, text, [], preferenceContext);
    }

    // Retrieve grounded evidence.
    const evidence = await this.selectEvidence(knowledgeConversationId, question);
    const { retrieved, relevant } = evidence;
    if (relevant.length === 0) {
      return this.refuse(
        conversationId,
        userMsg.id,
        mode,
        UserMessages.insufficientEvidence,
        retrieved,
        preferenceContext,
      );
    }

    // Generate the grounded answer.
    const answer = await this.generation.generateAnswer(
      mode,
      question,
      relevant,
      preferenceContext,
    );
    const confidence = this.generation.computeConfidence(relevant);
    const sources = this.generation.toSources(relevant);

    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(client, conversationId, 'assistant', answer, {
        sources,
        confidence,
        mode,
        preferenceContext,
        inferred: evidence.inferred,
        ...knowledgeMetadata,
      });
      await this.recordRunWithClient(client, {
        conversationId,
        userMessageId: userMsg.id,
        assistantMessageId: msg.id,
        mode,
        modelName: this.generation.modelName,
        chunks: relevant,
        confidence,
      });
      await this.touchWithClient(client, conversationId, question);
      return msg;
    });

    void this.preferences
      .learnFromTurn({ userId, question, answer, mode })
      .catch((err) =>
        this.logger.warn(`Preference learning skipped: ${err?.message}`),
      );

    return {
      messageId: assistantMsg.id,
      answer,
      sources,
      confidence,
      insufficient: false,
    };
  }

  async handleChatStream(
    userId: string,
    conversationId: string,
    body: ChatRequest,
    emit: ChatStreamEmit,
  ): Promise<void> {
    await this.conversations.ensureExists(conversationId, userId);

    const mode: AssistantMode = ASSISTANT_MODES.includes(body.mode as AssistantMode)
      ? (body.mode as AssistantMode)
      : 'qa';
    const question = (body.message?.trim() || MODE_DEFAULT_MESSAGE[mode]).trim();
    if (!question) {
      throw new AppError('A message is required.', HttpStatus.BAD_REQUEST);
    }

    const userMsg = await this.add(conversationId, 'user', question, { mode });
    emit({ type: 'message', messageId: userMsg.id, mode });

    const preferenceContext = await this.preferences.retrieveContext(userId, question);
    if (mode === 'web_research') {
      if (!config.ai.webResearchEnabled) {
        await this.streamRefuse(
          conversationId,
          userMsg.id,
          mode,
          UserMessages.webResearchDisabled,
          [],
          preferenceContext,
          emit,
        );
        return;
      }
      await this.handleWebResearchStream({
        userId,
        conversationId,
        userMessageId: userMsg.id,
        question,
        preferenceContext,
        emit,
      });
      return;
    }

    await this.handleDocumentStream({
      userId,
      conversationId,
      userMessageId: userMsg.id,
      mode,
      question,
      preferenceContext,
      emit,
    });
  }

  private async handleWebResearch(input: {
    userId: string;
    conversationId: string;
    userMessageId: string;
    question: string;
    preferenceContext?: string | null;
  }): Promise<ChatResponse> {
    const retrieved = await this.retrieval.retrieve(
      input.conversationId,
      input.question,
      config.retrieval.topK,
      ['uploaded_document', 'web_research'],
    );
    const relevant = this.retrieval.filterRelevant(retrieved);
    const result = await this.webResearch.research({
      conversationId: input.conversationId,
      question: input.question,
      contextChunks: relevant,
      preferenceContext: input.preferenceContext,
    });

    const auditChunks = [...relevant, ...result.savedChunks];
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(
        client,
        input.conversationId,
        'assistant',
        result.answer,
        {
          sources: result.sources,
          confidence: result.confidence,
          mode: 'web_research',
          preferenceContext: input.preferenceContext,
          webResearch: result.metadata,
        },
      );
      await this.recordRunWithClient(client, {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: msg.id,
        mode: 'web_research',
        modelName: this.generation.modelName,
        chunks: auditChunks,
        confidence: result.confidence,
        metadata: result.metadata,
      });
      await this.touchWithClient(client, input.conversationId, input.question);
      return msg;
    });

    void this.preferences
      .learnFromTurn({
        userId: input.userId,
        question: input.question,
        answer: result.answer,
        mode: 'web_research',
      })
      .catch((err) =>
        this.logger.warn(`Preference learning skipped: ${err?.message}`),
      );

    return {
      messageId: assistantMsg.id,
      answer: result.answer,
      sources: result.sources,
      confidence: result.confidence,
      insufficient: false,
    };
  }

  private async handleDocumentStream(input: {
    userId: string;
    conversationId: string;
    userMessageId: string;
    mode: AssistantMode;
    question: string;
    preferenceContext?: string | null;
    emit: ChatStreamEmit;
  }): Promise<void> {
    input.emit({ type: 'status', label: 'Checking approved documents' });
    const summary = await this.documents.getStatusSummary(
      input.conversationId,
      input.userId,
    );
    let knowledgeConversationId = input.conversationId;
    let knowledgeMetadata: Record<string, unknown> = {};

    if (summary.total === 0) {
      const demo = await this.getDemoKnowledge(input.userId);
      if (!demo) {
        await this.streamRefuse(
          input.conversationId,
          input.userMessageId,
          input.mode,
          UserMessages.noDocuments,
          [],
          input.preferenceContext,
          input.emit,
        );
        return;
      }
      knowledgeConversationId = demo.conversationId;
      knowledgeMetadata = {
        knowledgeBase: 'demo',
        knowledgeConversationId,
      };
    }

    if (summary.total > 0 && summary.indexed === 0) {
      await this.streamRefuse(
        input.conversationId,
        input.userMessageId,
        input.mode,
        summary.processing > 0
          ? UserMessages.documentsProcessing
          : UserMessages.noDocuments,
        [],
        input.preferenceContext,
        input.emit,
      );
      return;
    }

    input.emit({ type: 'status', label: 'Retrieving relevant evidence' });
    const evidence = await this.selectEvidence(
      knowledgeConversationId,
      input.question,
    );
    const { retrieved, relevant } = evidence;
    if (relevant.length === 0) {
      await this.streamRefuse(
        input.conversationId,
        input.userMessageId,
        input.mode,
        UserMessages.insufficientEvidence,
        retrieved,
        input.preferenceContext,
        input.emit,
      );
      return;
    }

    input.emit({ type: 'status', label: 'Generating answer' });
    let answer = '';
    for await (const chunk of this.generation.streamAnswer(
      input.mode,
      input.question,
      relevant,
      input.preferenceContext,
    )) {
      if (!chunk.text) continue;
      answer += chunk.text;
      input.emit({ type: 'delta', text: chunk.text });
    }

    const confidence = this.generation.computeConfidence(relevant);
    const sources = this.generation.toSources(relevant);
    input.emit({ type: 'sources', sources, confidence, insufficient: false });
    input.emit({ type: 'status', label: 'Saving response' });

    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(client, input.conversationId, 'assistant', answer, {
        sources,
        confidence,
        mode: input.mode,
        preferenceContext: input.preferenceContext,
        inferred: evidence.inferred,
        ...knowledgeMetadata,
      });
      await this.recordRunWithClient(client, {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: msg.id,
        mode: input.mode,
        modelName: this.generation.modelName,
        chunks: relevant,
        confidence,
      });
      await this.touchWithClient(client, input.conversationId, input.question);
      return msg;
    });

    void this.preferences
      .learnFromTurn({
        userId: input.userId,
        question: input.question,
        answer,
        mode: input.mode,
      })
      .catch((err) =>
        this.logger.warn(`Preference learning skipped: ${err?.message}`),
      );

    input.emit({ type: 'done', messageId: assistantMsg.id });
  }

  private async handleWebResearchStream(input: {
    userId: string;
    conversationId: string;
    userMessageId: string;
    question: string;
    preferenceContext?: string | null;
    emit: ChatStreamEmit;
  }): Promise<void> {
    input.emit({ type: 'status', label: 'Retrieving conversation context' });
    const retrieved = await this.retrieval.retrieve(
      input.conversationId,
      input.question,
      config.retrieval.topK,
      ['uploaded_document', 'web_research'],
    );
    const relevant = this.retrieval.filterRelevant(retrieved);

    input.emit({ type: 'status', label: 'Searching public web sources' });
    const result = await this.webResearch.researchStream(
      {
        conversationId: input.conversationId,
        question: input.question,
        contextChunks: relevant,
        preferenceContext: input.preferenceContext,
      },
      (text) => input.emit({ type: 'delta', text }),
      (label) => input.emit({ type: 'status', label }),
    );

    input.emit({
      type: 'sources',
      sources: result.sources,
      confidence: result.confidence,
      insufficient: false,
    });
    input.emit({ type: 'status', label: 'Saving response' });

    const auditChunks = [...relevant, ...result.savedChunks];
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(
        client,
        input.conversationId,
        'assistant',
        result.answer,
        {
          sources: result.sources,
          confidence: result.confidence,
          mode: 'web_research',
          preferenceContext: input.preferenceContext,
          webResearch: result.metadata,
        },
      );
      await this.recordRunWithClient(client, {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: msg.id,
        mode: 'web_research',
        modelName: this.generation.modelName,
        chunks: auditChunks,
        confidence: result.confidence,
        metadata: result.metadata,
      });
      await this.touchWithClient(client, input.conversationId, input.question);
      return msg;
    });

    void this.preferences
      .learnFromTurn({
        userId: input.userId,
        question: input.question,
        answer: result.answer,
        mode: 'web_research',
      })
      .catch((err) =>
        this.logger.warn(`Preference learning skipped: ${err?.message}`),
      );

    input.emit({ type: 'done', messageId: assistantMsg.id });
  }

  private async getDemoKnowledge(userId: string): Promise<{
    conversationId: string;
    summary: DocumentStatusSummary;
  } | null> {
    const conversationId = config.demoKnowledgeConversationId;
    if (!conversationId) return null;
    try {
      await this.conversations.ensureExists(conversationId, userId);
      const summary = await this.documents.getStatusSummary(conversationId, userId);
      if (summary.indexed === 0) return null;
      return { conversationId, summary };
    } catch (err: any) {
      this.logger.warn(
        `Demo knowledge base unavailable (${conversationId}): ${err?.message}`,
      );
      return null;
    }
  }

  private async selectEvidence(
    conversationId: string,
    question: string,
  ): Promise<EvidenceSelection> {
    const retrieved = await this.retrieval.retrieve(conversationId, question);
    let relevant = this.retrieval.filterRelevant(retrieved);
    let inferred = false;

    if (!this.needsAnalyticalContext(question) || relevant.length >= 3) {
      return { retrieved, relevant, inferred };
    }

    const analyticalRetrieved = await this.retrieval.retrieve(
      conversationId,
      this.analyticalRetrievalQuery(question),
      Math.max(config.retrieval.topK, 12),
    );
    const analyticalRelevant = analyticalRetrieved.filter(
      (chunk) => chunk.similarity >= this.analyticalSimilarityThreshold(),
    );
    relevant = this.mergeChunks(relevant, analyticalRelevant).slice(
      0,
      config.retrieval.topK,
    );
    inferred = relevant.length > 0;

    return {
      retrieved: this.mergeChunks(retrieved, analyticalRetrieved),
      relevant,
      inferred,
    };
  }

  private needsAnalyticalContext(question: string): boolean {
    return /\b(risks?|risk|next steps?|recommend(?:ed|ation|ations)?|should|priorit(?:y|ies|ize|ise)|opportunit(?:y|ies)|implications?|strategy|strategic|roadmap|challenges?|constraints?|trade-?offs?|mitigations?|actions?|implementation|implement|infer(?:red)?|analysis|analy[sz]e|assessment|assess|compare|gap|risques?|recommandations?|priorites?|priorités?|etapes?|étapes?|strategie|stratégie|تحليل|مخاطر|توصيات|خطوات)\b/i.test(
      question,
    );
  }

  private analyticalRetrievalQuery(question: string): string {
    const subject = question
      .replace(
        /\b(what|which|who|are|is|the|main|key|implementation|risks?|and|recommended|recommendations?|next|steps?|for|of|about|should|priorit(?:y|ies|ize|ise)|opportunit(?:y|ies)|implications?|strategy|strategic|roadmap|challenges?|constraints?|trade-?offs?|mitigations?|actions?|implement|infer(?:red)?|analysis|analy[sz]e|assessment|assess|compare|gap)\b/gi,
        ' ',
      )
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${subject || question} project goals scope modules capabilities workflows users actors requirements expected result operations dependencies payments reservations providers dashboards communication loyalty constraints future evolution`;
  }

  private analyticalSimilarityThreshold(): number {
    return Math.min(config.retrieval.similarityThreshold, 0.35);
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

  // Store a grounded refusal / insufficient-evidence response.
  private async refuse(
    conversationId: string,
    userMessageId: string,
    mode: AssistantMode,
    text: string,
    retrieved: RetrievedChunk[] = [],
    preferenceContext?: string | null,
  ): Promise<ChatResponse> {
    const answer = this.styleRefusal(text, preferenceContext);
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(client, conversationId, 'assistant', answer, {
        sources: [],
        confidence: 'low' as Confidence,
        mode,
        insufficient: true,
        preferenceContext,
      });
      await this.recordRunWithClient(client, {
        conversationId,
        userMessageId,
        assistantMessageId: msg.id,
        mode,
        modelName: null,
        chunks: retrieved,
        confidence: 'low',
      });
      await this.touchWithClient(client, conversationId);
      return msg;
    });
    return {
      messageId: assistantMsg.id,
      answer,
      sources: [],
      confidence: 'low',
      insufficient: true,
    };
  }

  private async streamRefuse(
    conversationId: string,
    userMessageId: string,
    mode: AssistantMode,
    text: string,
    retrieved: RetrievedChunk[],
    preferenceContext: string | null | undefined,
    emit: ChatStreamEmit,
  ): Promise<void> {
    emit({ type: 'status', label: 'Saving response' });
    const response = await this.refuse(
      conversationId,
      userMessageId,
      mode,
      text,
      retrieved,
      preferenceContext,
    );
    emit({ type: 'delta', text: response.answer });
    emit({
      type: 'sources',
      sources: response.sources,
      confidence: response.confidence,
      insufficient: response.insufficient,
    });
    emit({ type: 'done', messageId: response.messageId });
  }

  private styleRefusal(text: string, preferenceContext?: string | null): string {
    if (!preferenceContext) return text;
    if (!/arabic|العربية|عربي/i.test(preferenceContext)) return text;
    if (text === UserMessages.noDocuments) {
      return 'لا توجد مستندات معتمدة في هذه المحادثة حتى الآن. يرجى تحميل مستندات ذات صلة كي أجيب بناء عليها فقط.';
    }
    if (text === UserMessages.documentsProcessing) {
      return 'ما زالت المستندات قيد الفهرسة. يرجى المحاولة مرة أخرى بعد اكتمال المعالجة.';
    }
    if (text === UserMessages.insufficientEvidence) {
      return 'لا تتضمن المستندات المعتمدة أدلة كافية للإجابة عن هذا الطلب بثقة. يرجى تحميل مصدر ذي صلة أو تضييق نطاق السؤال.';
    }
    return text;
  }

  private async addWithClient(
    client: PoolClient,
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<Message> {
    const result = await client.query<Message>(
      `insert into messages (conversation_id, role, content, metadata)
       values ($1, $2, $3, $4::jsonb) returning *`,
      [conversationId, role, content, JSON.stringify(metadata)],
    );
    return DatabaseService.requireRow(result, 'Message insert returned no row.');
  }

  // Audit metadata (PRD §13.9 / §14.5).
  private async recordRunWithClient(client: PoolClient, input: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    mode: AssistantMode;
    modelName: string | null;
    chunks: RetrievedChunk[];
    confidence: Confidence;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const chunkIds = input.chunks.map((c) => c.id);
    const documentIds = [...new Set(input.chunks.map((c) => c.document_id))];
    await client.query(
      `insert into assistant_runs
         (conversation_id, user_message_id, assistant_message_id, mode, model_name,
          retrieved_chunk_ids, retrieved_document_ids, confidence, metadata)
       values ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9::jsonb)`,
      [
        input.conversationId,
        input.userMessageId,
        input.assistantMessageId,
        input.mode,
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
}
