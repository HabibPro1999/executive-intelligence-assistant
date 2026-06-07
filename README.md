# Executive Intelligence Assistant

A secure, **document-grounded executive intelligence assistant** that turns approved
uploaded business documents into decision-ready strategic outputs — executive
summaries, strategic briefings, financial-center benchmarks, market opportunity
analyses, and performance insights — **with source citations and disciplined
refusal when evidence is missing**.

It is *not* a generic chatbot. Every answer is grounded only in the documents the
user uploaded into the current conversation, using a conversation-scoped RAG
pipeline (Retrieval-Augmented Generation).

---

## 1. Scope interpretation

The brief asks for an AI assistant for an executive user that supports approved
document upload, document-based Q&A, executive summarization, strategic briefings,
financial-center benchmarking, market opportunity analysis, and performance
insights, plus PowerPoint strategy-deck generation — **with all answers based on
submitted files**, and explicitly *without*
web search, live competitor monitoring, news feeds, or authenticated enterprise
user management.

The correct technical reading is therefore: **build a document-grounded RAG
assistant** that treats uploaded files as the approved knowledge base and produces
executive-ready outputs from those files only. That is exactly what this project
implements (Tier 1 MVP + Tier 2 enterprise-like polish from the PRD).

---

## 2. Architecture

```
  ┌───────────────────────────┐        ┌────────────────────────────────────────┐
  │  Frontend (Next.js/Vercel)│        │            Backend (NestJS/Render)        │
  │  - Chat UI + file upload  │        │                                          │
  │  - Document sidebar       │ HTTPS  │  Conversations ─ Messages (chat orchestr.)│
  │  - Executive action btns  │ ─────► │  Documents ─► Extraction ─► Chunking      │
  │  - Strategy deck export   │        │  Decks ─► PPTX renderer                  │
  │  - Source + confidence    │  REST  │       │            (pdf/docx/xlsx)        │
  └───────────────────────────┘        │       ▼                                  │
                                        │   Embeddings (Gemini) ─► Retrieval       │
                                        │       │                     │            │
                                        │       ▼                     ▼            │
   ┌──────────────┐   ┌──────────────┐  │  Generation (Gemini Flash) grounded ans. │
   │ Supabase     │   │ Supabase     │◄─┤                                          │
   │ Storage      │   │ Postgres +   │  └────────────────────────────────────────┘
   │ (orig files) │   │ pgvector     │
   └──────────────┘   └──────────────┘
```

**Upload → index flow:** validate → store original in Supabase Storage → create
`documents` record → extract text/tables → chunk (≈800 tokens, 120 overlap, metadata
preserved) → embed chunks (Gemini) → store chunks + vectors in `document_chunks` →
mark `indexed`. Runs asynchronously so the upload responds quickly; the sidebar shows
`uploaded → processing → indexed / failed`.

**Chat flow:** embed the query → pgvector cosine similarity search scoped to the
conversation and to `indexed` + `approved` documents → if the conversation has no
documents, optionally fall back to a configured demo knowledge base → if nothing
clears the relevance threshold, return an insufficient-evidence refusal → otherwise
build a mode-specific prompt with the retrieved context → Gemini Flash generates a
grounded answer → persist the message, citations, confidence label, and an
`assistant_runs` audit record.

**Strategy deck flow:** use the same scoped retrieval/refusal path → generate a
strict JSON deck specification with cited chunk IDs → persist it in
`presentation_decks` → render an editable `.pptx` on download. The deck action also
writes an `assistant_runs` record with retrieved chunk IDs, documents, model, deck id,
and confidence.

---

## 3. Tech stack

| Layer        | Choice                                            |
|--------------|---------------------------------------------------|
| Frontend     | Next.js 14 (App Router), TypeScript, Tailwind CSS, react-markdown |
| Backend      | NestJS 10, TypeScript, REST                       |
| Database     | Supabase Postgres + `pgvector`                    |
| File storage | Supabase Storage                                  |
| Embeddings   | Gemini `gemini-embedding-2` (768-dim output)      |
| Generation   | Gemini `gemini-2.5-flash-lite`                    |
| Parsing      | `pdf-parse` (PDF), `mammoth` (DOCX), `xlsx` (XLSX) |
| Deck export  | `pptxgenjs` editable PowerPoint generation        |
| Hosting      | Vercel (frontend) · Render (backend)              |

---

## 4. How RAG works here (and why it stays grounded)

1. **Chunking with metadata.** Each chunk keeps `page_number`, `sheet_name`,
   `section_title`, and `document_id`, so every cited claim is traceable. Excel rows
   are grouped into readable, row-ranged text rather than embedded one cell at a time.
2. **User-owned, conversation-scoped retrieval.** Every protected request is tied to a
   Supabase Auth user, and every similarity query filters by `conversation_id`.
   Conversation ownership is checked before documents, messages, and decks are read
   or written.
3. **Threshold + refusal.** If no chunk clears `SIMILARITY_THRESHOLD`, the assistant
   refuses with a clear message instead of hallucinating.
4. **Grounded prompts.** A strict system prompt forbids outside knowledge and
   requires citations; each executive mode has its own structured output template.
5. **Embedded user preference context.** A compact user preference profile is embedded
   and retrieved as style-only context before generation. It can shape language, tone,
   depth, format, and audience, but never factual evidence or citations.
6. **Confidence labels.** Derived from how many chunks and documents support the
   answer (high / medium / low).

### Why no web search in the initial scope
The assignment specifies outputs must be based on submitted files. Excluding web
search is intentional: it demonstrates enterprise-grade grounding and removes a major
hallucination/compliance risk. Web research is described as a future mode (Tier 3),
not built.

### Authentication scope
Supabase Auth is used for user ownership and personalization. The app intentionally
does not implement RBAC or workspaces: users can access only their own conversations,
documents, messages, preference profile, and decks.

---

## 5. Project layout

```
backend/      NestJS RAG API (modules: conversations, messages, documents,
              extraction, chunking, embeddings, retrieval, generation, decks, …)
  db/schema.sql           Postgres + pgvector schema and similarity function
frontend/     Next.js chat app (chat, documents sidebar, executive actions)
sample-docs/  Generator + 5 synthetic demo documents (PRD §24)
```

---

## 6. Local setup

### Prerequisites
- Node.js 18+ (20+ recommended)
- A Supabase project (Postgres + Storage) with `pgvector`
- A Gemini API key (Google AI Studio)

### 6.1 Database
In the Supabase SQL editor (or `psql "$DATABASE_URL"`), run the schema:
```bash
backend/db/schema.sql
```
This enables `pgvector`, creates all tables, the ANN index, and the
`match_document_chunks` similarity function.

### 6.2 Storage
Create a Storage bucket (default name `documents`) in Supabase. It can be private —
the backend uses the service-role key and signed URLs.

### 6.3 Backend
```bash
cd backend
cp .env.example .env     # fill in the values (see §7)
npm install
npm run start:dev        # http://localhost:8080  (health: /api/health)
```

### 6.4 Frontend
```bash
cd frontend
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:8080
npm install
npm run dev              # http://localhost:3000
```

### 6.5 Sample documents
```bash
cd sample-docs
npm install && node generate.mjs   # regenerates the 5 demo files
```
Upload them in the UI to test the fictional demo corpus.
Use **Strategy Deck** in the executive action bar to generate a sourced PPTX briefing
from the same approved corpus.

To wipe the configured Supabase app tables/storage and seed fictional users, docs,
history, and one Arabic-first preference profile, start the backend, then run:
```bash
cd backend
npm run reset:seed
```
This is destructive for app data in the configured Supabase project. It deletes only
the known seeded Auth users, then recreates them with email/password for local test
login.

> Offline check (no API keys needed): `cd backend && ./node_modules/.bin/ts-node
> verify-extraction.ts` runs the real extraction + chunking on the sample docs.

---

## 7. Environment variables

### Backend (`backend/.env`)
| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server only) |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name (default `documents`) |
| `DATABASE_URL` | Postgres connection string (pooler recommended) |
| `DEMO_KNOWLEDGE_CONVERSATION_ID` | optional user-owned indexed demo corpus for empty conversations |
| `GEMINI_API_KEY` | Gemini API key |
| `GEMINI_EMBEDDING_MODEL` | default `gemini-embedding-2` (768-dim output) |
| `GEMINI_GENERATION_MODEL` | default `gemini-2.5-flash-lite` |
| `GEMINI_REQUEST_TIMEOUT_MS` | Gemini request timeout in milliseconds (default `60000`) |
| `MAX_FILE_SIZE_MB` | default `10` |
| `MAX_FILES_PER_CONVERSATION` | default `5` |
| `MAX_CHUNKS_PER_CONVERSATION` | default `100` (demo safety) |
| `TOP_K_CHUNKS` | default `10` |
| `SIMILARITY_THRESHOLD` | min cosine similarity for relevance (default `0.72`) |
| `PORT` | default `8080` |
| `CORS_ORIGINS` | comma-separated allowed origins (the frontend URL) |
| `SEED_API_URL` | backend API base for `npm run reset:seed` |
| `SEED_USER_PASSWORD` | password used for seeded test users |

### Frontend (`frontend/.env.local`)
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend base URL, no trailing slash (client appends `/api`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key for browser auth |
| `NEXT_PUBLIC_ENABLE_PASSWORD_AUTH` | set `true` only for local seeded test login |

> **Security:** `GEMINI_API_KEY` and the Supabase **service-role** key live only in
> the backend environment. The frontend never calls Gemini or Supabase directly.

---

## 8. Deployment

**Backend → Render** (a `render.yaml` blueprint is included):
- Build command: `npm install && npm run build`
- Start command: `npm run start:prod`
- Health check path: `/api/health`
- Set all backend env vars; set `CORS_ORIGINS` to the Vercel URL.

**Frontend → Vercel:**
- Root directory: `frontend`
- Set `NEXT_PUBLIC_API_URL` to the Render backend URL.

Run `backend/db/schema.sql` against the Supabase database once before first use.

---

## 9. API summary

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/conversations` | Create user-owned conversation |
| `GET`  | `/api/conversations` | Recent user-owned conversations |
| `GET`  | `/api/conversations/:id` | Conversation + messages + documents |
| `POST` | `/api/conversations/:id/documents` | Upload a file (multipart) |
| `GET`  | `/api/conversations/:id/documents` | Document statuses |
| `GET`  | `/api/conversations/:id/documents/status-summary` | Lightweight document status summary |
| `POST` | `/api/conversations/:id/messages` | Chat / generate an executive output |
| `POST` | `/api/conversations/:id/decks` | Generate a sourced strategy-deck spec |
| `GET`  | `/api/conversations/:id/decks/:deckId/download` | Download editable PPTX |
| `GET`  | `/api/me/preferences` | View learned style preference profile |
| `DELETE` | `/api/me/preferences` | Reset learned style preference profile |

All app-data endpoints require `Authorization: Bearer <Supabase access token>`.

Chat request body: `{ "message": "...", "mode": "qa | executive_summary |
strategic_briefing | financial_center_benchmark | market_opportunity_analysis |
performance_insights" }`. Response includes `answer`, `sources[]`, `confidence`, and
`insufficient`.

Deck request body: `{ "message": "Generate a board-ready strategy deck ..." }`.
Response includes `answer`, `deck`, `sources[]`, `confidence`, and `insufficient`.
`deck.downloadUrl` returns an editable PowerPoint file.

---

## 10. Known limitations

- **Synchronous-ish processing.** Indexing runs in-process (async, not awaited) per
  the PRD's deployment-simplicity guidance. For higher volume, move it to a queue
  (BullMQ + Redis or a DB-driven job table) — the pipeline is already isolated.
- **Demo safety caps.** 10 MB/file, 5 files/conversation, 100 chunks/conversation.
- **Page numbers for DOCX** are unavailable (the format has none); section titles are
  detected heuristically and used for citations instead.
- **No RBAC/workspaces.** Auth is user ownership only; there are no roles, teams, or
  admin workflows.
- **Live/external data is intentionally refused** — outputs are document-grounded.
- **Deck design is deterministic and editable**, but it is a generated consulting
  layout rather than a branded enterprise template.

---

## 11. Future improvements (roadmap)

- **Near-term:** per-query document selection, PDF preview with citation
  highlighting, source reranking, export to PDF/Word, shareable conversation links.
- **Enterprise:** authentication, workspaces, RBAC, approved document library, admin
  approval workflow, SSO, audit dashboard, data-retention settings.
- **Intelligence:** opt-in web research mode, competitor monitoring, scheduled
  market briefs, CRM/SharePoint/Drive integration.
- **AI quality:** hybrid (vector + keyword) search, reranking, query rewriting,
  answer-quality evaluation, hallucination detection, task-based model routing.

---

## 12. Final principle

> Use uploaded approved documents as the only source of truth, retrieve the most
> relevant evidence, then transform that evidence into concise, executive-ready
> intelligence with citations.
