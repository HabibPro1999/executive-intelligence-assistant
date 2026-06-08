export interface GroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: { web?: { uri?: string; title?: string } }[];
  groundingSupports?: unknown[];
  searchEntryPoint?: unknown;
}

export interface GenerateResult {
  text: string;
  groundingMetadata?: GroundingMetadata;
}

export interface StreamChunk {
  text?: string;
  groundingMetadata?: GroundingMetadata;
}

export type CompetitorResearchReason =
  | 'explicit_competitors_found'
  | 'company_context_enough'
  | 'insufficient_context';

export interface CompetitorResearchPreflight {
  shouldAskUser: boolean;
  reason: CompetitorResearchReason;
  companyName?: string;
  competitors: string[];
  clarifyingQuestion?: string;
}

export type RetrievalPlanIntent =
  | 'direct'
  | 'analytical'
  | 'comparison'
  | 'risk'
  | 'recommendation';

export interface RetrievalPlan {
  queries: string[];
  intent: RetrievalPlanIntent;
  reason: string;
}
