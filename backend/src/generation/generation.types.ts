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
