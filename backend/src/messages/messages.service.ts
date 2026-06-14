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
import {
  CompetitorResearchPreflight,
  RetrievalPlan,
} from '../generation/generation.types';
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

// Cheap model for the additive follow-up suggestions call (sibling of the
// primary generation model). Kept local so this feature touches no shared config.
const SUGGESTIONS_MODEL = 'gpt-4.1-mini';

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

// Optional KPI chart for in-browser rendering (additive, failure-isolated;
// sibling of the `suggestions` event). Emitted only when the data clearly
// supports exactly one chart.
export interface ChartSpec {
  kind: 'bar' | 'grouped-bar' | 'line';
  title: string;
  xLabel?: string;
  yLabel?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
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
  | { type: 'suggestions'; items: string[] }
  | { type: 'chart'; spec: ChartSpec }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export type ChatStreamEmit = (event: ChatStreamEvent) => void;

interface EvidenceSelection {
  retrieved: RetrievedChunk[];
  relevant: RetrievedChunk[];
  inferred: boolean;
  metadata: Record<string, unknown>;
}

interface WebResearchPreparation {
  question: string;
  contextChunks: RetrievedChunk[];
  retrieved: RetrievedChunk[];
  competitorPreflight?: CompetitorResearchPreflight;
  clarifyingQuestion?: string;
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
    const preferenceUpdate = this.preferenceUpdateFrom(question);
    if (preferenceUpdate) {
      return this.handlePreferenceUpdate({
        userId,
        conversationId,
        userMessageId: userMsg.id,
        mode,
        preference: preferenceUpdate,
      });
    }

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
    const evidence = await this.selectEvidence(knowledgeConversationId, question, mode);
    const { retrieved, relevant } = evidence;
    if (relevant.length === 0) {
      return this.refuse(
        conversationId,
        userMsg.id,
        mode,
        UserMessages.insufficientEvidence,
        retrieved,
        preferenceContext,
        evidence.metadata,
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
        metadata: evidence.metadata,
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

    const preferenceUpdate = this.preferenceUpdateFrom(question);
    if (preferenceUpdate) {
      emit({ type: 'status', label: 'Saving preference' });
      const response = await this.handlePreferenceUpdate({
        userId,
        conversationId,
        userMessageId: userMsg.id,
        mode,
        preference: preferenceUpdate,
      });
      emit({ type: 'delta', text: response.answer });
      emit({
        type: 'sources',
        sources: response.sources,
        confidence: response.confidence,
        insufficient: response.insufficient,
      });
      emit({ type: 'done', messageId: response.messageId });
      return;
    }

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
    const prepared = await this.prepareWebResearch(
      input.conversationId,
      input.question,
    );
    if (prepared.clarifyingQuestion) {
      return this.refuse(
        input.conversationId,
        input.userMessageId,
        'web_research',
        prepared.clarifyingQuestion,
        prepared.retrieved,
        input.preferenceContext,
      );
    }

    const result = await this.webResearch.research({
      conversationId: input.conversationId,
      question: prepared.question,
      contextChunks: prepared.contextChunks,
      preferenceContext: input.preferenceContext,
    });
    const webResearchMetadata = {
      ...result.metadata,
      competitorPreflight: prepared.competitorPreflight,
    };

    const auditChunks = [...prepared.contextChunks, ...result.savedChunks];
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
          webResearch: webResearchMetadata,
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
        metadata: webResearchMetadata,
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

  private async handlePreferenceUpdate(input: {
    userId: string;
    conversationId: string;
    userMessageId: string;
    mode: AssistantMode;
    preference: string;
  }): Promise<ChatResponse> {
    await this.preferences.saveExplicitPreference({
      userId: input.userId,
      preference: input.preference,
      metadata: { lastMode: input.mode },
    });
    const answer = this.preferenceSavedAnswer(input.preference);
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(
        client,
        input.conversationId,
        'assistant',
        answer,
        {
          sources: [],
          confidence: 'high' as Confidence,
          mode: input.mode,
          preferenceUpdate: true,
          preference: input.preference,
        },
      );
      await this.recordRunWithClient(client, {
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: msg.id,
        mode: input.mode,
        modelName: null,
        chunks: [],
        confidence: 'high',
        metadata: {
          preference_update: true,
          preference: input.preference,
        },
      });
      await this.touchWithClient(client, input.conversationId);
      return msg;
    });

    return {
      messageId: assistantMsg.id,
      answer,
      sources: [],
      confidence: 'high',
      insufficient: false,
    };
  }

  private preferenceUpdateFrom(question: string): string | null {
    const text = question.replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const explicit =
      /\b(i prefer|i like|i want|my preference is|set my preference|remember that i|from now on|always (?:answer|respond|reply|use)|please (?:answer|respond|reply|use)|(?:answer|respond|reply) in)\b/i.test(
        text,
      ) || /(?:أفضل|افضل|أريد|اريد|جاوب|أجب|اجب|بالعربية|عربي|العربية)/i.test(text);
    if (!explicit) return null;

    if (/arabic|العربية|عربي|بالعربية/i.test(text)) {
      return 'Respond in Arabic by default.';
    }
    if (/\b(french|français|francais)\b/i.test(lower)) {
      return 'Respond in French by default.';
    }
    if (/\b(english|anglais)\b/i.test(lower)) {
      return 'Respond in English by default.';
    }
    if (/\b(concise|brief|short|مختصر|قصير)\b/i.test(lower)) {
      return 'Prefer concise responses.';
    }
    if (/\b(detailed|deep|comprehensive|تفصيلي|مفصل)\b/i.test(lower)) {
      return 'Prefer detailed responses.';
    }
    if (/\b(bullets|bullet points|نقاط)\b/i.test(lower)) {
      return 'Prefer bullet-point responses.';
    }

    const cleaned = text
      .replace(
        /^(please\s+)?(remember that\s+)?(i prefer|i like|i want|my preference is|set my preference to|from now on,?|always|please)/i,
        '',
      )
      .trim();
    if (!cleaned || cleaned.length < 4 || cleaned.length > 160) return null;
    return `User preference: ${cleaned}.`;
  }

  private preferenceSavedAnswer(preference: string): string {
    if (/arabic|العربية|عربي/i.test(preference)) {
      return 'تم حفظ التفضيل. سأجيب بالعربية في الردود القادمة.';
    }
    if (/french|français|francais/i.test(preference)) {
      return 'Préférence enregistrée. Je répondrai en français dans les prochaines réponses.';
    }
    return 'Preference saved. I will apply it to future responses.';
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
      input.mode,
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
        evidence.metadata,
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
        metadata: evidence.metadata,
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

    await this.emitSuggestions(input.question, answer, input.emit);
    await this.emitChart(
      input.question,
      answer,
      this.chartContext(relevant, answer),
      input.emit,
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
    const prepared = await this.prepareWebResearch(
      input.conversationId,
      input.question,
      (label) => input.emit({ type: 'status', label }),
    );
    if (prepared.clarifyingQuestion) {
      await this.streamRefuse(
        input.conversationId,
        input.userMessageId,
        'web_research',
        prepared.clarifyingQuestion,
        prepared.retrieved,
        input.preferenceContext,
        input.emit,
      );
      return;
    }

    input.emit({ type: 'status', label: 'Searching public web sources' });
    const result = await this.webResearch.researchStream(
      {
        conversationId: input.conversationId,
        question: prepared.question,
        contextChunks: prepared.contextChunks,
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

    const webResearchMetadata = {
      ...result.metadata,
      competitorPreflight: prepared.competitorPreflight,
    };
    const auditChunks = [...prepared.contextChunks, ...result.savedChunks];
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
          webResearch: webResearchMetadata,
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
        metadata: webResearchMetadata,
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

    await this.emitSuggestions(input.question, result.answer, input.emit);
    await this.emitChart(
      input.question,
      result.answer,
      this.chartContext(auditChunks, result.answer),
      input.emit,
    );
    input.emit({ type: 'done', messageId: assistantMsg.id });
  }

  private async prepareWebResearch(
    conversationId: string,
    question: string,
    emitStatus?: (label: string) => void,
  ): Promise<WebResearchPreparation> {
    const retrieved = await this.retrieval.retrieve(
      conversationId,
      question,
      config.retrieval.topK,
      ['uploaded_document', 'web_research'],
    );
    let contextChunks = this.retrieval.filterRelevant(retrieved);
    let allRetrieved = retrieved;

    if (!this.isCompetitorResearchRequest(question)) {
      return { question, contextChunks, retrieved: allRetrieved };
    }

    emitStatus?.('Identifying competitor context');
    const competitorRetrieved = await this.retrieval.retrieve(
      conversationId,
      this.competitorContextQuery(question),
      Math.max(config.retrieval.topK, 12),
      ['uploaded_document', 'web_research'],
    );
    allRetrieved = this.mergeChunks(retrieved, competitorRetrieved);
    const competitorContext = competitorRetrieved.filter(
      (chunk) => chunk.similarity >= this.analyticalSimilarityThreshold(),
    );
    contextChunks = this.mergeChunks(contextChunks, competitorContext).slice(
      0,
      Math.max(config.retrieval.topK, 12),
    );

    const competitorPreflight = await this.generation.classifyCompetitorResearch(
      question,
      contextChunks,
    );
    if (competitorPreflight.shouldAskUser) {
      return {
        question,
        contextChunks,
        retrieved: allRetrieved,
        competitorPreflight,
        clarifyingQuestion:
          competitorPreflight.clarifyingQuestion ||
          'Which company or competitors should I research? I do not have enough context in this conversation to identify them reliably.',
      };
    }

    return {
      question: this.competitorResearchQuestion(question, competitorPreflight),
      contextChunks,
      retrieved: allRetrieved,
      competitorPreflight,
    };
  }

  private isCompetitorResearchRequest(question: string): boolean {
    return /\b(competitor|competitors|competitive intelligence|competitive landscape|rival|rivals|competing|market players?|alternatives)\b/i.test(
      question,
    );
  }

  private competitorContextQuery(question: string): string {
    return `${question} company product market industry sector customers positioning competitors rivals alternatives competitive landscape benchmark`;
  }

  private competitorResearchQuestion(
    question: string,
    preflight: CompetitorResearchPreflight,
  ): string {
    const targetLines: string[] = [];
    if (preflight.companyName) targetLines.push(`Company or market: ${preflight.companyName}`);
    if (preflight.competitors.length) {
      targetLines.push(`Competitors to research: ${preflight.competitors.join(', ')}`);
    }
    const instruction = preflight.competitors.length
      ? 'Run live web research for all listed competitors and compare the current signals.'
      : 'Use live web research to identify relevant competitors for the company or market, then summarize the current signals.';

    return `${question}

Resolved competitor research context:
${targetLines.join('\n')}

${instruction}`;
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
    mode: AssistantMode,
  ): Promise<EvidenceSelection> {
    const retrieved = await this.retrieval.retrieve(conversationId, question);
    let relevant = this.retrieval.filterRelevant(retrieved);
    const directMetadata = this.retrievalMetadata('direct', {
      queries: [question],
      intent: 'direct',
      reason: 'Used direct retrieval only.',
    });

    if (!this.needsAnalyticalContext(question) && relevant.length >= 3) {
      return { retrieved, relevant, inferred: false, metadata: directMetadata };
    }

    let plan: RetrievalPlan;
    try {
      plan = await this.generation.planRetrievalQueries(
        mode,
        question,
        this.retrievalPlanningContext(relevant, retrieved),
      );
    } catch (err: any) {
      this.logger.warn(`Retrieval planning skipped: ${err?.message}`);
      plan = this.fallbackRetrievalPlan(question);
    }

    const expandedRetrievedGroups: RetrievedChunk[][] = [retrieved];
    const expandedRelevantGroups: RetrievedChunk[][] = [relevant];
    for (const query of plan.queries.slice(1)) {
      if (this.sameQuery(query, question)) continue;
      const queryRetrieved = await this.retrieval.retrieve(
        conversationId,
        query,
        config.retrieval.topK,
      );
      expandedRetrievedGroups.push(queryRetrieved);
      expandedRelevantGroups.push(
        this.filterExpandedRelevant(queryRetrieved, question, query, plan),
      );
    }

    const expandedRetrieved = this.mergeChunks(...expandedRetrievedGroups);
    relevant = this.mergeChunks(...expandedRelevantGroups).slice(
      0,
      config.retrieval.topK,
    );

    return {
      retrieved: expandedRetrieved,
      relevant,
      inferred: relevant.length > 0,
      metadata: this.retrievalMetadata('expanded', plan, relevant.length),
    };
  }

  private needsAnalyticalContext(question: string): boolean {
    return /\b(risks?|risk|next steps?|recommend(?:ed|ation|ations)?|should|priorit(?:y|ies|ize|ise)|opportunit(?:y|ies)|implications?|strategy|strategic|roadmap|challenges?|constraints?|trade-?offs?|mitigations?|actions?|implementation|implement|infer(?:red)?|analysis|analy[sz]e|assessment|assess|compare|gap|risques?|recommandations?|priorites?|priorités?|etapes?|étapes?|strategie|stratégie|تحليل|مخاطر|توصيات|خطوات)\b/i.test(
      question,
    );
  }

  private retrievalPlanningContext(
    relevant: RetrievedChunk[],
    retrieved: RetrievedChunk[],
  ): RetrievedChunk[] {
    return (relevant.length ? relevant : retrieved).slice(0, 5);
  }

  private sameQuery(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  private fallbackRetrievalPlan(question: string): RetrievalPlan {
    const intent = this.needsAnalyticalContext(question) ? 'analytical' : 'direct';
    return {
      queries: [question, this.broadRetrievalQuery(question)],
      intent,
      reason: 'Used deterministic fallback retrieval expansion.',
    };
  }

  private broadRetrievalQuery(question: string): string {
    const subject = question
      .replace(
        /\b(what|which|who|are|is|the|main|key|implementation|risks?|and|recommended|recommendations?|next|steps?|for|of|about|should|priorit(?:y|ies|ize|ise)|opportunit(?:y|ies)|implications?|strategy|strategic|roadmap|challenges?|constraints?|trade-?offs?|mitigations?|actions?|implement|infer(?:red)?|analysis|analy[sz]e|assessment|assess|compare|gap)\b/gi,
        ' ',
      )
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${subject || question} overview profile summary business model product financial highlights KPIs risks opportunities recommendations`;
  }

  private filterExpandedRelevant(
    chunks: RetrievedChunk[],
    question: string,
    query: string,
    plan: RetrievalPlan,
  ): RetrievedChunk[] {
    const strict = this.retrieval.filterRelevant(chunks);
    if (strict.length) return strict;

    const candidates = chunks.filter(
      (chunk) => chunk.similarity >= this.expandedSimilarityThreshold(plan),
    );
    if (!candidates.length) return [];

    const anchors = this.anchorTokens(`${question} ${query}`);
    if (!anchors.length) return candidates;
    return candidates.filter((chunk) => this.chunkMatchesAnchor(chunk, anchors));
  }

  private expandedSimilarityThreshold(plan: RetrievalPlan): number {
    if (plan.intent === 'direct') {
      return Math.min(config.retrieval.similarityThreshold, 0.35);
    }
    return this.analyticalSimilarityThreshold();
  }

  private anchorTokens(text: string): string[] {
    const stop = new Set([
      'what',
      'whats',
      'which',
      'who',
      'are',
      'about',
      'company',
      'competitor',
      'competitors',
      'financial',
      'financials',
      'summary',
      'profile',
      'business',
      'model',
      'product',
      'description',
      'sector',
      'services',
      'overview',
      'state',
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

  private retrievalMetadata(
    strategy: 'direct' | 'expanded',
    plan: RetrievalPlan,
    expandedChunkCount = 0,
  ): Record<string, unknown> {
    return {
      retrieval_strategy: strategy,
      generated_queries: plan.queries,
      query_intent: plan.intent,
      retrieval_plan_reason: plan.reason,
      expanded_chunk_count: expandedChunkCount,
    };
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
    metadata?: Record<string, unknown>,
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
        metadata,
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
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    emit({ type: 'status', label: 'Saving response' });
    const response = await this.refuse(
      conversationId,
      userMessageId,
      mode,
      text,
      retrieved,
      preferenceContext,
      metadata,
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

  // Follow-up suggestions (additive, failure-isolated). Makes ONE cheap extra
  // OpenAI call for 3 short follow-up questions grounded in the question +
  // answer, then emits a `suggestions` event. ANY failure is swallowed: it must
  // never delay-block or break the already-saved answer. This does NOT touch
  // the main answer generation call or its prompt.
  private async emitSuggestions(
    question: string,
    answer: string,
    emit: ChatStreamEmit,
  ): Promise<void> {
    try {
      const apiKey = config.ai.generation.apiKey;
      if (!apiKey) return;

      const instructions =
        'You generate follow-up questions for an executive intelligence assistant. ' +
        'Given the user QUESTION and the assistant ANSWER, return exactly 3 short, ' +
        'specific follow-up questions an executive might ask next, grounded in the ' +
        'answer and question. Return ONLY a JSON array of 3 strings, nothing else.';
      const input =
        `QUESTION:\n${question.slice(0, 2000)}\n\n` +
        `ANSWER:\n${answer.slice(0, 4000)}`;

      const res = await fetch(`${config.ai.generation.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
        body: JSON.stringify({
          model: SUGGESTIONS_MODEL,
          instructions,
          input,
          temperature: 0.4,
          max_output_tokens: 256,
          stream: false,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Suggestions skipped: HTTP ${res.status}`);
        return;
      }

      const data: any = await res.json();
      const items = this.parseSuggestions(data);
      if (items.length) emit({ type: 'suggestions', items });
    } catch (err: any) {
      this.logger.warn(`Suggestions skipped: ${err?.message}`);
    }
  }

  private parseSuggestions(data: any): string[] {
    const text =
      typeof data?.output_text === 'string'
        ? data.output_text
        : Array.isArray(data?.output)
          ? data.output
              .map((item: any) =>
                Array.isArray(item?.content)
                  ? item.content
                      .map((part: any) =>
                        typeof part?.text === 'string' ? part.text : '',
                      )
                      .join('')
                  : '',
              )
              .join('')
          : '';
    if (!text) return [];

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 3);
  }

  // Optional KPI chart (additive, failure-isolated; mirrors emitSuggestions).
  // Makes ONE cheap extra OpenAI call: given the QUESTION, the final ANSWER and
  // whatever numeric/evidence CONTEXT is in scope, decide if the data clearly
  // supports exactly one chart. If yes, emit a strict ChartSpec; if not, emit
  // nothing. ANY failure is swallowed and never touches the main answer call.
  private async emitChart(
    question: string,
    answer: string,
    context: string,
    emit: ChatStreamEmit,
  ): Promise<void> {
    try {
      const apiKey = config.ai.generation.apiKey;
      if (!apiKey) return;

      const instructions =
        'You build at most ONE chart for an executive intelligence assistant. ' +
        'Given the user QUESTION, the assistant ANSWER and supporting CONTEXT, ' +
        'decide if the data clearly and unambiguously supports a single chart of ' +
        'KPIs. Only build a chart when concrete numeric values with clear labels ' +
        'are present. If the data does not clearly support one chart, return null. ' +
        'When you do build one, return ONLY a JSON object (no prose) of shape ' +
        '{"kind":"bar"|"grouped-bar"|"line","title":string,"xLabel"?:string,' +
        '"yLabel"?:string,"categories":string[],"series":[{"name":string,' +
        '"values":number[]}]}. Every series.values length MUST equal categories ' +
        'length. Use at most 12 categories and at most 4 series. If unsure, return null.';
      const input =
        `QUESTION:\n${question.slice(0, 2000)}\n\n` +
        `ANSWER:\n${answer.slice(0, 4000)}\n\n` +
        `CONTEXT:\n${context.slice(0, 4000)}`;

      const res = await fetch(`${config.ai.generation.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(config.ai.requestTimeoutMs),
        body: JSON.stringify({
          model: SUGGESTIONS_MODEL,
          instructions,
          input,
          temperature: 0.2,
          max_output_tokens: 512,
          stream: false,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Chart skipped: HTTP ${res.status}`);
        return;
      }

      const data: any = await res.json();
      const spec = this.parseChart(data);
      if (spec) emit({ type: 'chart', spec });
    } catch (err: any) {
      this.logger.warn(`Chart skipped: ${err?.message}`);
    }
  }

  // Assembles the numeric/evidence context fed to the chart call from the
  // retrieved chunks in scope; falls back to the answer text when none exist.
  private chartContext(chunks: RetrievedChunk[], answer: string): string {
    const text = (Array.isArray(chunks) ? chunks : [])
      .map((chunk) => chunk?.content)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .join('\n\n')
      .trim();
    return text || answer;
  }

  private parseChart(data: any): ChartSpec | null {
    const text =
      typeof data?.output_text === 'string'
        ? data.output_text
        : Array.isArray(data?.output)
          ? data.output
              .map((item: any) =>
                Array.isArray(item?.content)
                  ? item.content
                      .map((part: any) =>
                        typeof part?.text === 'string' ? part.text : '',
                      )
                      .join('')
                  : '',
              )
              .join('')
          : '';
    if (!text) return null;

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const allowedKinds = new Set(['bar', 'grouped-bar', 'line']);
    const kind = allowedKinds.has(parsed.kind) ? parsed.kind : null;
    if (!kind) return null;

    const title =
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : null;
    if (!title) return null;

    const categories = (Array.isArray(parsed.categories) ? parsed.categories : [])
      .filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c: string) => c.trim())
      .slice(0, 12);
    if (!categories.length) return null;

    const rawSeries = Array.isArray(parsed.series) ? parsed.series : [];
    const series: ChartSpec['series'] = [];
    for (const entry of rawSeries.slice(0, 4)) {
      if (!entry || typeof entry !== 'object') continue;
      const name =
        typeof entry.name === 'string' && entry.name.trim()
          ? entry.name.trim()
          : `Series ${series.length + 1}`;
      const rawValues = Array.isArray(entry.values) ? entry.values : [];
      const values = rawValues.map((v: unknown) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : NaN;
      });
      // Drop the chart if any series has no valid numbers or a length mismatch.
      if (!values.some((v: number) => Number.isFinite(v))) return null;
      if (values.length !== categories.length) return null;
      if (values.some((v: number) => !Number.isFinite(v))) return null;
      series.push({ name, values });
    }
    if (!series.length) return null;

    const spec: ChartSpec = { kind, title, categories, series };
    if (typeof parsed.xLabel === 'string' && parsed.xLabel.trim()) {
      spec.xLabel = parsed.xLabel.trim();
    }
    if (typeof parsed.yLabel === 'string' && parsed.yLabel.trim()) {
      spec.yLabel = parsed.yLabel.trim();
    }
    return spec;
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
