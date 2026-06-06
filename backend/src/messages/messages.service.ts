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

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsService,
    private readonly documents: DocumentsService,
    private readonly retrieval: RetrievalService,
    private readonly generation: GenerationService,
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
    conversationId: string,
    body: ChatRequest,
  ): Promise<ChatResponse> {
    await this.conversations.ensureExists(conversationId);

    const mode: AssistantMode = ASSISTANT_MODES.includes(body.mode as AssistantMode)
      ? (body.mode as AssistantMode)
      : 'qa';
    const question = (body.message?.trim() || MODE_DEFAULT_MESSAGE[mode]).trim();
    if (!question) {
      throw new AppError('A message is required.', HttpStatus.BAD_REQUEST);
    }

    const userMsg = await this.add(conversationId, 'user', question, { mode });

    // Guard: documents must exist and be indexed before answering. Empty
    // conversations may fall back to a configured demo knowledge base.
    const summary = await this.documents.getStatusSummary(conversationId);
    let knowledgeConversationId = conversationId;
    let knowledgeMetadata: Record<string, unknown> = {};
    if (summary.total === 0) {
      const demo = await this.getDemoKnowledge();
      if (!demo) {
        return this.refuse(
          conversationId,
          userMsg.id,
          mode,
          UserMessages.noDocuments,
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
      return this.refuse(conversationId, userMsg.id, mode, text);
    }

    // Retrieve grounded evidence.
    const retrieved = await this.retrieval.retrieve(knowledgeConversationId, question);
    const relevant = this.retrieval.filterRelevant(retrieved);
    if (relevant.length === 0) {
      return this.refuse(
        conversationId,
        userMsg.id,
        mode,
        UserMessages.insufficientEvidence,
        retrieved,
      );
    }

    // Generate the grounded answer.
    const answer = await this.generation.generateAnswer(mode, question, relevant);
    const confidence = this.generation.computeConfidence(relevant);
    const sources = this.generation.toSources(relevant);

    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(client, conversationId, 'assistant', answer, {
        sources,
        confidence,
        mode,
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

    return {
      messageId: assistantMsg.id,
      answer,
      sources,
      confidence,
      insufficient: false,
    };
  }

  private async getDemoKnowledge(): Promise<{
    conversationId: string;
    summary: DocumentStatusSummary;
  } | null> {
    const conversationId = config.demoKnowledgeConversationId;
    if (!conversationId) return null;
    try {
      const summary = await this.documents.getStatusSummary(conversationId);
      if (summary.indexed === 0) return null;
      return { conversationId, summary };
    } catch (err: any) {
      this.logger.warn(
        `Demo knowledge base unavailable (${conversationId}): ${err?.message}`,
      );
      return null;
    }
  }

  // Store a grounded refusal / insufficient-evidence response.
  private async refuse(
    conversationId: string,
    userMessageId: string,
    mode: AssistantMode,
    text: string,
    retrieved: RetrievedChunk[] = [],
  ): Promise<ChatResponse> {
    const assistantMsg = await this.db.withTransaction(async (client) => {
      const msg = await this.addWithClient(client, conversationId, 'assistant', text, {
        sources: [],
        confidence: 'low' as Confidence,
        mode,
        insufficient: true,
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
      answer: text,
      sources: [],
      confidence: 'low',
      insufficient: true,
    };
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
        JSON.stringify({ chunk_count: chunkIds.length }),
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
