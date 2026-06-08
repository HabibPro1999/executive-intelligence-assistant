// Centralised, typed access to environment configuration.
// Keeping this in one place means every module reads the same defaults.

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function baseUrl(key: string, fallback: string): string {
  return str(key, fallback).replace(/\/$/, '');
}

export const config = {
  port: num('PORT', 8080),
  // Defaults to the local frontend so dev works out of the box. In production
  // set this to the deployed frontend origin(s). CORS is always an explicit
  // allowlist — it never reflects arbitrary origins (see main.ts).
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  supabase: {
    url: str('SUPABASE_URL'),
    serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    bucket: str('SUPABASE_STORAGE_BUCKET', 'documents'),
  },

  databaseUrl: str('DATABASE_URL'),
  demoKnowledgeConversationId: str('DEMO_KNOWLEDGE_CONVERSATION_ID'),

  ai: {
    requestTimeoutMs: num('AI_REQUEST_TIMEOUT_MS', 60_000),
    webResearchEnabled: bool('ENABLE_WEB_RESEARCH', true),
    generation: {
      baseUrl: baseUrl('GENERATION_BASE_URL', 'https://api.openai.com/v1'),
      apiKey: str('OPENAI_API_KEY'),
      model: str('GENERATION_MODEL', 'gpt-4.1'),
    },
    embeddings: {
      baseUrl: baseUrl('EMBEDDING_BASE_URL', 'https://api.openai.com/v1'),
      apiKey: str('OPENAI_API_KEY', str('EMBEDDING_API_KEY')),
      model: str('EMBEDDING_MODEL', 'text-embedding-3-small'),
      dimensions: num('EMBEDDING_DIMENSIONS', 768),
    },
  },

  limits: {
    maxFileSizeMb: num('MAX_FILE_SIZE_MB', 10),
    maxFilesPerConversation: num('MAX_FILES_PER_CONVERSATION', 5),
    maxChunksPerConversation: num('MAX_CHUNKS_PER_CONVERSATION', 100),
  },

  retrieval: {
    topK: num('TOP_K_CHUNKS', 10),
    // Minimum cosine similarity for a chunk to be treated as relevant evidence.
    similarityThreshold: num('SIMILARITY_THRESHOLD', 0.5),
  },
} as const;

export const SUPPORTED_FILE_TYPES = ['pdf', 'docx', 'xlsx'] as const;
export type SupportedFileType = (typeof SUPPORTED_FILE_TYPES)[number];
