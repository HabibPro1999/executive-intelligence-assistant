// Shared frontend types, mirroring the backend API contract (PRD §15).

// Feature D — KPI chart spec, re-exported from the ChartBlock unit so the
// stream event and ChatMessage can reference a single source of truth.
export type { ChartSpec } from '@/components/chat/ChartBlock';
import type { ChartSpec } from '@/components/chat/ChartBlock';

export type MessageRole = 'user' | 'assistant' | 'system';
export type Confidence = 'high' | 'medium' | 'low';
export type DocumentStatus = 'uploaded' | 'processing' | 'indexed' | 'failed';
export type SourceType = 'uploaded_document' | 'web_research';

export const ASSISTANT_MODES = [
  'qa',
  'executive_summary',
  'strategic_briefing',
  'financial_center_benchmark',
  'market_opportunity_analysis',
  'performance_insights',
  'web_research',
] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

// Deck visual template. 'classic' = original consulting template;
// 'nextgen' = McKinsey-grade dark theme from the reference deck.
export type DeckStyle = 'classic' | 'nextgen';

export interface Source {
  documentId: string | null;
  filename: string;
  pageNumber: number | null;
  sheetName: string | null;
  sectionTitle: string | null;
  chunkId: string;
  sourceType?: SourceType;
  url?: string | null;
  domain?: string | null;
  retrievedAt?: string | null;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at?: string;
  metadata?: {
    progress?: string[];
    streaming?: boolean;
    sources?: Source[];
    confidence?: Confidence;
    mode?: AssistantMode | 'strategy_deck';
    insufficient?: boolean;
    deck?: DeckSummary | null;
  };
  // Reasoning-trace step labels (status events), shown via ThinkingTrace.
  steps?: string[];
  // Optional best-effort follow-up suggestions emitted just before 'done'.
  suggestions?: string[];
  // Optional best-effort KPI chart emitted just before 'done' (Feature D).
  chart?: ChartSpec;
  // Local-only flag for the in-flight assistant placeholder.
  pending?: boolean;
}

export interface DocumentRecord {
  id: string;
  filename: string;
  file_type: string;
  source_type?: SourceType;
  status: DocumentStatus;
  approval_status: string;
  page_count: number | null;
  sheet_count: number | null;
  error_message: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
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
  | { type: 'suggestions'; items: string[] }
  | { type: 'chart'; spec: ChartSpec }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export interface DocumentStatusSummary {
  total: number;
  indexed: number;
  processing: number;
  failed: number;
}

export interface DeckSlideSummary {
  type: string;
  headline: string;
  keyMessage: string;
}

// Feature C — richer per-slide preview, returned at the top level of the
// createDeck response and surfaced into DeckSummary.previewSlides by api.ts.
export interface DeckPreviewSlide {
  title: string;
  subtitle?: string;
  bullets?: string[];
  kind?: string;
}

export interface DeckSummary {
  deckId: string;
  title: string;
  thesis: string;
  slides: DeckSlideSummary[];
  // Optional rich preview slides (Feature C); copied from the createDeck
  // response's top-level `slides` field. Empty/absent on refusal.
  previewSlides?: DeckPreviewSlide[];
  sources: Source[];
  confidence: Confidence;
  insufficient: boolean;
  style?: DeckStyle;
  downloadUrl: string;
}

export interface DeckCreateResponse {
messageId: string;
answer: string;
deck: DeckSummary | null;
slides?: DeckPreviewSlide[];
sources: Source[];
confidence: Confidence;
insufficient: boolean;
}

export interface UserPreferenceProfile {
user_id: string;
content: string;
metadata: Record<string, unknown>;
created_at: string;
updated_at: string;
}
