-- Executive Intelligence Assistant — database schema (Supabase Postgres + pgvector)
-- Run this once against your Supabase project (SQL editor or psql via DATABASE_URL).
-- Embedding dimension is 768 to match OpenAI text-embedding-3-small with dimensions=768.

create extension if not exists vector;
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- 1. conversations -----------------------------------------------------------
create table if not exists conversations (
id uuid primary key default gen_random_uuid(),
user_id uuid not null references auth.users(id) on delete cascade,
title text,
created_at timestamptz default now(),
updated_at timestamptz default now()
);
create index if not exists idx_conversations_user on conversations(user_id, updated_at desc);

-- 2. messages ----------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);

-- 3. documents ---------------------------------------------------------------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  filename text not null,
  file_type text not null,
  storage_path text not null,
  source_type text not null default 'uploaded_document'
    check (source_type in ('uploaded_document', 'web_research')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'indexed', 'failed')),
  approval_status text not null default 'approved'
    check (approval_status in ('approved', 'pending', 'rejected')),
  page_count int,
  sheet_count int,
  error_message text,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_documents_conversation on documents(conversation_id);

alter table documents
  add column if not exists source_type text not null default 'uploaded_document';
do $$
begin
  alter table documents
    add constraint documents_source_type_check
    check (source_type in ('uploaded_document', 'web_research'));
exception
  when duplicate_object then null;
end $$;
create index if not exists idx_documents_source_type on documents(conversation_id, source_type);

-- 4. document_chunks ---------------------------------------------------------
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  page_number int,
  sheet_name text,
  section_title text,
  token_count int,
  metadata jsonb default '{}',
  embedding vector(768),
  created_at timestamptz default now()
);
create index if not exists idx_chunks_conversation on document_chunks(conversation_id);
create index if not exists idx_chunks_document on document_chunks(document_id);
-- Approximate-nearest-neighbour index for cosine similarity.
create index if not exists idx_chunks_embedding
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- 5. assistant_runs ----------------------------------------------------------
create table if not exists assistant_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  user_message_id uuid references messages(id) on delete set null,
  assistant_message_id uuid references messages(id) on delete set null,
  mode text not null,
  model_name text,
  retrieved_chunk_ids uuid[] default '{}',
  retrieved_document_ids uuid[] default '{}',
  confidence text check (confidence in ('high', 'medium', 'low')),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_runs_conversation on assistant_runs(conversation_id, created_at);

-- 6. presentation decks ------------------------------------------------------
create table if not exists presentation_decks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  title text not null,
  request text not null,
  deck_spec jsonb not null,
  source_chunk_ids uuid[] default '{}',
  model_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_decks_conversation on presentation_decks(conversation_id, created_at);

create table if not exists user_preference_profiles (
user_id uuid primary key references auth.users(id) on delete cascade,
content text not null,
embedding vector(768),
metadata jsonb default '{}',
created_at timestamptz default now(),
updated_at timestamptz default now()
);
create index if not exists idx_user_preference_profiles_embedding
on user_preference_profiles using hnsw (embedding vector_cosine_ops);

-- 7. similarity search function ---------------------------------------------
-- Returns the top-k most similar chunks within a single conversation,
-- restricted to indexed + approved documents (data isolation, PRD §21.2).
-- similarity is cosine similarity in [0,1]; higher is more relevant.
drop function if exists match_document_chunks(uuid, vector, int);
drop function if exists match_document_chunks(uuid, vector, int, text[]);
create or replace function match_document_chunks(
  p_conversation_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 10,
  p_source_types text[] default array['uploaded_document']
)
returns table (
  id uuid,
  document_id uuid,
  conversation_id uuid,
  chunk_index int,
  content text,
  page_number int,
  sheet_name text,
  section_title text,
  filename text,
  file_type text,
  source_type text,
  source_url text,
  source_title text,
  retrieved_at text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.conversation_id,
    c.chunk_index,
    c.content,
    c.page_number,
    c.sheet_name,
    c.section_title,
    d.filename,
    d.file_type,
    d.source_type,
    coalesce(c.metadata->>'sourceUrl', d.metadata->>'sourceUrl') as source_url,
    coalesce(c.metadata->>'sourceTitle', d.metadata->>'sourceTitle') as source_title,
    coalesce(c.metadata->>'retrievedAt', d.metadata->>'retrievedAt') as retrieved_at,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from document_chunks c
  join documents d on d.id = c.document_id
  where c.conversation_id = p_conversation_id
    and d.status = 'indexed'
    and d.approval_status = 'approved'
    and d.source_type = any(p_source_types)
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;
