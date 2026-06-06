// Shared domain types for the Executive Intelligence Assistant backend.

export type DocumentStatus = 'uploaded' | 'processing' | 'indexed' | 'failed';
export type ApprovalStatus = 'approved' | 'pending' | 'rejected';
export type MessageRole = 'user' | 'assistant' | 'system';
export type Confidence = 'high' | 'medium' | 'low';

// Executive output modes (PRD §15.6 / §13.8).
export const ASSISTANT_MODES = [
  'qa',
  'executive_summary',
  'strategic_briefing',
  'financial_center_benchmark',
  'market_opportunity_analysis',
  'performance_insights',
] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  conversation_id: string;
  filename: string;
  file_type: string;
  storage_path: string;
  status: DocumentStatus;
  approval_status: ApprovalStatus;
  page_count: number | null;
  sheet_count: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// A unit of extracted content before chunking.
export interface ExtractedSegment {
  content: string;
  page_number?: number | null;
  sheet_name?: string | null;
  section_title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExtractionResult {
  segments: ExtractedSegment[];
  page_count?: number | null;
  sheet_count?: number | null;
}

// A chunk produced by the chunking service, ready for embedding.
export interface ContentChunk {
  chunk_index: number;
  content: string;
  page_number?: number | null;
  sheet_name?: string | null;
  section_title?: string | null;
  token_count: number;
  metadata?: Record<string, unknown>;
}

// A chunk returned by retrieval, joined with its parent document metadata.
export interface RetrievedChunk {
  id: string;
  document_id: string;
  conversation_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  sheet_name: string | null;
  section_title: string | null;
  filename: string;
  file_type: string;
  similarity: number;
}

// Source citation returned to the frontend (PRD §15.6).
export interface Source {
  documentId: string;
  filename: string;
  pageNumber: number | null;
  sheetName: string | null;
  sectionTitle: string | null;
  chunkId: string;
}

export type DeckSlideType =
  | 'title'
  | 'thesis'
  | 'priorities'
  | 'opportunity'
  | 'benchmark'
  | 'performance'
  | 'recommendations'
  | 'appendix';

export type DeckVisualType = 'none' | 'callout' | 'table' | 'chart';

export interface DeckVisual {
  type: DeckVisualType;
  title?: string;
  columns?: string[];
  rows?: string[][];
}

export interface DeckSlide {
  type: DeckSlideType;
  headline: string;
  keyMessage: string;
  bullets: string[];
  visual: DeckVisual;
  speakerNotes: string;
  sourceRefs: string[];
}

export interface DeckSource {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  sheetName: string | null;
  sectionTitle: string | null;
}

export interface DeckSpec {
  title: string;
  subtitle: string;
  thesis: string;
  audience: string;
  slides: DeckSlide[];
  sources: DeckSource[];
}

export interface DeckSummary {
  deckId: string;
  title: string;
  thesis: string;
  slides: Pick<DeckSlide, 'type' | 'headline' | 'keyMessage'>[];
  sources: Source[];
  confidence: Confidence;
  insufficient: boolean;
  downloadUrl: string;
}
