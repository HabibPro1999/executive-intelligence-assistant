import { Injectable } from '@nestjs/common';
import {
  CompetitorResearchPreflight,
  GenerateResult,
  RetrievalPlan,
  RetrievalPlanIntent,
  StreamChunk,
} from './generation.types';
import { OpenAiResponsesGenerationProvider } from './openai-responses-generation.provider';
import {
  BASE_SYSTEM_PROMPT,
  buildCompetitorResearchPreflightPrompt,
  buildDeckPrompt,
  buildPreferenceInferencePrompt,
  buildRetrievalPlanPrompt,
  buildUserPrompt,
  buildWebResearchPrompt,
  formatContext,
  WEB_RESEARCH_SYSTEM_PROMPT,
} from './prompt-templates';
import { config } from '../common/config';
import {
  AssistantMode,
  Confidence,
  DeckSpec,
  RetrievedChunk,
  Source,
} from '../common/types';

@Injectable()
export class GenerationService {
  constructor(private readonly provider: OpenAiResponsesGenerationProvider) {}

  get modelName(): string {
    return config.ai.generation.model;
  }

  // Generate a grounded answer from the retrieved chunks.
  async generateAnswer(
    mode: AssistantMode,
    question: string,
    chunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): Promise<string> {
    const contextText = formatContext(chunks);
    const userPrompt = buildUserPrompt(
      mode,
      question,
      contextText,
      preferenceContext,
    );
    return this.provider.generate(BASE_SYSTEM_PROMPT, userPrompt);
  }

  async generateDeckSpec(
    question: string,
    chunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): Promise<DeckSpec> {
    const contextText = formatContext(chunks);
    const userPrompt = buildDeckPrompt(question, contextText, preferenceContext);
    const text = await this.provider.generate(BASE_SYSTEM_PROMPT, userPrompt, {
      maxOutputTokens: 4096,
      temperature: 0.15,
    });
    const json = this.extractJson(text);
    return JSON.parse(json) as DeckSpec;
  }

  async inferPreferenceProfile(input: {
    currentProfile: string;
    question: string;
    answer: string;
    mode: string;
  }): Promise<string | null> {
    const prompt = buildPreferenceInferencePrompt(input);
    const text = await this.provider.generate(
      'You extract durable user style preferences. Return only NO_CHANGE or the updated profile text.',
      prompt,
      { maxOutputTokens: 512, temperature: 0.1 },
    );
    const cleaned = text.trim();
    if (!cleaned || /^NO_CHANGE$/i.test(cleaned)) return null;
    return cleaned.slice(0, 1200);
  }

  async generateWebResearch(
    question: string,
    contextChunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): Promise<GenerateResult> {
    const contextText = formatContext(contextChunks);
    const userPrompt = buildWebResearchPrompt({
      question,
      contextText,
      preferenceContext,
      currentDate: new Date().toISOString().slice(0, 10),
    });
    return this.provider.generateWithWebSearch(
      WEB_RESEARCH_SYSTEM_PROMPT,
      userPrompt,
      { maxOutputTokens: 4096, temperature: 0.2 },
    );
  }

  async classifyCompetitorResearch(
    question: string,
    contextChunks: RetrievedChunk[],
  ): Promise<CompetitorResearchPreflight> {
    const contextText = formatContext(contextChunks);
    const userPrompt = buildCompetitorResearchPreflightPrompt({
      question,
      contextText,
    });
    const text = await this.provider.generate(
      'You classify competitor research requests. Return strict JSON only.',
      userPrompt,
      { maxOutputTokens: 800, temperature: 0 },
    );
    return this.normalizeCompetitorPreflight(JSON.parse(this.extractJson(text)));
  }

  async planRetrievalQueries(
    mode: AssistantMode,
    question: string,
    contextChunks: RetrievedChunk[],
  ): Promise<RetrievalPlan> {
    const contextText = formatContext(contextChunks);
    const userPrompt = buildRetrievalPlanPrompt({
      mode,
      question,
      contextText,
    });
    const text = await this.provider.generate(
      'You plan retrieval queries for a document-grounded RAG system. Return strict JSON only.',
      userPrompt,
      { maxOutputTokens: 700, temperature: 0 },
    );
    return this.normalizeRetrievalPlan(JSON.parse(this.extractJson(text)), question);
  }

  streamAnswer(
    mode: AssistantMode,
    question: string,
    chunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): AsyncGenerator<StreamChunk> {
    const contextText = formatContext(chunks);
    const userPrompt = buildUserPrompt(
      mode,
      question,
      contextText,
      preferenceContext,
    );
    return this.provider.stream(BASE_SYSTEM_PROMPT, userPrompt);
  }

  streamWebResearch(
    question: string,
    contextChunks: RetrievedChunk[],
    preferenceContext?: string | null,
  ): AsyncGenerator<StreamChunk> {
    const contextText = formatContext(contextChunks);
    const userPrompt = buildWebResearchPrompt({
      question,
      contextText,
      preferenceContext,
      currentDate: new Date().toISOString().slice(0, 10),
    });
    return this.provider.streamWithWebSearch(
      WEB_RESEARCH_SYSTEM_PROMPT,
      userPrompt,
      { maxOutputTokens: 4096, temperature: 0.2 },
    );
  }

  private extractJson(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) return fenced[1].trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
    return trimmed;
  }

  private normalizeCompetitorPreflight(value: any): CompetitorResearchPreflight {
    const reason = [
      'explicit_competitors_found',
      'company_context_enough',
      'insufficient_context',
    ].includes(value?.reason)
      ? value.reason
      : 'insufficient_context';
    const competitors = Array.isArray(value?.competitors)
      ? [
          ...new Set<string>(
            value.competitors.flatMap((item: unknown) =>
              typeof item === 'string' && item.trim() ? [item.trim()] : [],
            ),
          ),
        ].slice(0, 12)
      : [];
    const companyName =
      typeof value?.companyName === 'string' && value.companyName.trim()
        ? value.companyName.trim()
        : undefined;
    const shouldAskUser = Boolean(value?.shouldAskUser) || reason === 'insufficient_context';
    const clarifyingQuestion =
      typeof value?.clarifyingQuestion === 'string' && value.clarifyingQuestion.trim()
        ? value.clarifyingQuestion.trim()
        : undefined;

    return {
      shouldAskUser,
      reason,
      companyName,
      competitors,
      clarifyingQuestion,
    };
  }

  private normalizeRetrievalPlan(value: any, question: string): RetrievalPlan {
    const intents: RetrievalPlanIntent[] = [
      'direct',
      'analytical',
      'comparison',
      'risk',
      'recommendation',
    ];
    const intent = intents.includes(value?.intent) ? value.intent : 'direct';
    const seen = new Set<string>();
    const queries = [question, ...(Array.isArray(value?.queries) ? value.queries : [])]
      .flatMap((item: unknown) =>
        typeof item === 'string' && item.trim() ? [item.trim()] : [],
      )
      .filter((item: string) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
    const reason =
      typeof value?.reason === 'string' && value.reason.trim()
        ? value.reason.trim().slice(0, 500)
        : 'Generated retrieval expansion queries.';

    return { queries, intent, reason };
  }

  // Confidence heuristic (PRD §19).
  computeConfidence(relevantChunks: RetrievedChunk[]): Confidence {
    const docCount = new Set(relevantChunks.map((c) => c.document_id)).size;
    if (relevantChunks.length >= 3 && docCount >= 2) return 'high';
    if (relevantChunks.length >= 2) return 'medium';
    return 'low';
  }

  // Build citation list, de-duplicated by document + page/sheet/section.
  toSources(chunks: RetrievedChunk[]): Source[] {
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const c of chunks) {
      const key = `${c.document_id}|${c.page_number ?? ''}|${c.sheet_name ?? ''}|${c.section_title ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        documentId: c.document_id,
        filename: c.source_title || c.filename,
        pageNumber: c.page_number,
        sheetName: c.sheet_name,
        sectionTitle: c.section_title,
        chunkId: c.id,
        sourceType: c.source_type,
        url: c.source_url,
        domain: c.source_url ? this.hostname(c.source_url) : null,
        retrievedAt: c.retrieved_at,
      });
    }
    return sources;
  }

  private hostname(value: string): string | null {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
}
