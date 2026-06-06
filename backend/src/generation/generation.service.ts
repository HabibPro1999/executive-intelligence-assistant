import { Injectable } from '@nestjs/common';
import { GeminiGenerationProvider } from './gemini-generation.provider';
import {
  BASE_SYSTEM_PROMPT,
  buildDeckPrompt,
  buildUserPrompt,
  formatContext,
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
  constructor(private readonly provider: GeminiGenerationProvider) {}

  get modelName(): string {
    return config.gemini.generationModel;
  }

  // Generate a grounded answer from the retrieved chunks.
  async generateAnswer(
    mode: AssistantMode,
    question: string,
    chunks: RetrievedChunk[],
  ): Promise<string> {
    const contextText = formatContext(chunks);
    const userPrompt = buildUserPrompt(mode, question, contextText);
    return this.provider.generate(BASE_SYSTEM_PROMPT, userPrompt);
  }

  async generateDeckSpec(question: string, chunks: RetrievedChunk[]): Promise<DeckSpec> {
    const contextText = formatContext(chunks);
    const userPrompt = buildDeckPrompt(question, contextText);
    const text = await this.provider.generate(BASE_SYSTEM_PROMPT, userPrompt, {
      maxOutputTokens: 4096,
      temperature: 0.15,
    });
    const json = this.extractJson(text);
    return JSON.parse(json) as DeckSpec;
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
        filename: c.filename,
        pageNumber: c.page_number,
        sheetName: c.sheet_name,
        sectionTitle: c.section_title,
        chunkId: c.id,
      });
    }
    return sources;
  }
}
