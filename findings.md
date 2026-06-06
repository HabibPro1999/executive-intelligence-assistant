# Whole-system review — executive-intelligence-assistant

Max-effort review of the entire system (NestJS RAG backend + Next.js frontend, ~2,900 LOC TS).

**Method:** 55-agent workflow — 9 independent finder angles → 56 raw candidates → 39 unique → 33+4 verified (1-vote, 3-state) → synthesized to 15. Top mechanisms re-verified against source by hand.

**Tags:** 🔴 critical · 🟠 high · 🟡 medium. "latent" = correct today, breaks on the config/evolution trigger named in the scenario.

---

## 🔴 Security

### 1. No auth/ownership on any route
`backend/src/conversations/conversations.controller.ts:23`

No `user_id` column on conversations and no `UseGuards` anywhere (`main.ts` registers only CORS + ValidationPipe + MulterExceptionFilter). Every route authorizes solely on the conversation UUID in the URL.

**Failure:** Anyone who learns or guesses a conversation UUID (leaked share link, logs, Referer header) can read its full transcript and document metadata (`getFull`), upload documents into it (`documents.controller.ts:25`), and run chat/retrieval against its private chunks (`match_document_chunks` is scoped only by `conversation_id`, `schema.sql:122`). UUIDv4 is not enumerable, so the practical trigger is UUID leakage.

**Fix:** Add a tenant/ownership invariant (auth guard + `user_id` scoping); do not authorize on URL secrecy alone.

### 2. File-quota TOCTOU — cap bypassable by parallel upload
`backend/src/documents/documents.service.ts:60`

The `SELECT count(*) … status <> 'failed'` (L60-64) and the `INSERT` (L70-74) are two separate unlocked pool queries, while the sibling chunk-budget path correctly uses `pg_advisory_xact_lock`.

**Failure:** N concurrent `POST /conversations/:id/documents` at count=4 (limit 5) each read 4, each pass the `>=5` check, each insert → 6+ documents persisted, each consuming embedding/chunk quota. Separately, a doc stuck in `'processing'` (hung Gemini call) keeps consuming a slot since the counter only excludes `'failed'`.

**Fix:** Take the same advisory lock / run count+insert inside `withTransaction`.

---

## 🟠 Correctness — data integrity

### 3. xlsx row-range citation metadata corrupted
`backend/src/chunking/chunking.service.ts:76`

`metaKey()` (L13) keys on `page|sheet|section` and excludes per-segment row range. Consecutive row-batches of one sheet share the key, so the grouping loop (L56-64) merges them into one chunk, but `metadata: base.metadata` (L76) stamps only the **first** batch's `{row_start,row_end}`.

**Failure:** A 30-row sheet emits 2 segments (rows 2-16, 17-31); merged (<3200 chars) into one chunk whose content spans rows 2-31 but whose metadata records `row_end=16`. Persisted to `document_chunks.metadata` (`document-processing.service.ts:142`) → any citation/preview misattributes the back half of the data to the wrong rows.

**Fix:** Include row range in `metaKey`, or recompute the merged range across the group.

### 4. Embedding batch positional misalignment *(latent — Gemini behavior)*
`backend/src/embeddings/gemini-embeddings.provider.ts:57`

`for (const e of data.embeddings) vectors.push(e.values)` never asserts `data.embeddings.length === batch.length`; it appends to a flat positional array across multiple 100-item batches.

**Failure:** For a >100-chunk document, if any batch returns HTTP 200 with fewer/more entries than sent, every subsequent chunk pairs with the wrong vector → embeddings silently stored against the wrong chunk content → retrieval returns confidently-cited but semantically wrong passages. The global `vectors.length !== chunks.length` guard (`document-processing.service.ts:62`) is defeated when an under-count in one batch is offset by an over-count in another.

**Fix:** Assert per-batch `data.embeddings.length === batch.length`.

---

## 🟠 Correctness — failure handling

### 5. No fetch timeout → docs stuck 'processing' forever
`backend/src/embeddings/gemini-embeddings.provider.ts:50`

`fetch` (L50 batch, L66 query) has no `AbortController`/signal, and Node's fetch has no default total-response deadline.

**Failure:** A stalled Gemini connection means `process()` (fire-and-forget at `documents.service.ts:99`) never settles → the `catch`/`fail()` never runs → the row pinned at `status='processing'` forever while the frontend polls every 2.5s (`ChatApp.tsx:68`) indefinitely. `embedQuery` hangs a live chat turn the same way, holding a pool connection.

**Fix:** Pass `AbortSignal.timeout(...)` to every Gemini fetch.

### 6. Unvalidated Gemini response shape → opaque 500
`backend/src/embeddings/gemini-embeddings.provider.ts:77`

`res.ok` only guarantees a 2xx status; L77 then dereferences `data.embedding.values` (and L57 iterates `data.embeddings`) with no shape check.

**Failure:** Gemini returns HTTP 200 with a body lacking `embedding` (e.g. `{}`) → raw `TypeError`. `AppError` extends `HttpException` but a `TypeError` does not, and the only global filter is `MulterExceptionFilter` (`@Catch(MulterError)`), so NestJS serializes a generic 500 instead of the intended `BAD_GATEWAY` `embeddingFailed` — on every chat query.

**Fix:** Validate response shape and throw `AppError` on mismatch.

### 7. Truncated answer returned as complete
`backend/src/generation/gemini-generation.provider.ts:56`

Returns `candidates[0]` text verbatim regardless of `finishReason`; truncation (`MAX_TOKENS`) is only logged when text is empty, never when partial; `blockReason`/`promptFeedback` is never read.

**Failure:** With hardcoded `maxOutputTokens=2048`, a long answer is truncated but still returns partial text → the cut-off string is returned with full confidence + citations, shown to the user as complete. In the empty-parts variant, MAX_TOKENS/SAFETY/RECITATION/upstream all collapse to one generic `llmFailed`, so the user retries fruitlessly.

**Fix:** Surface `finishReason`; distinguish truncation/safety/recitation from generic failure.

### 8. Assistant message committed before audit/ordering completes
`backend/src/messages/messages.service.ts:103`

The answer row is committed (L103) before `recordRun` (L162) and `conversations.touch` (L118), with no `withTransaction`.

**Failure:** If `recordRun`/`touch` throws (transient pg error, statement timeout, dropped connection), `handleChat` rejects and the UI renders `⚠️` (insufficient), but the committed orphan row has metadata with no `insufficient` flag → on reload `MessageBubble` (L34, `confidence && !insufficient`) renders it as a normal successful answer with badge + sources. Same turn: error live, success after refresh; the audit row is missing.

**Fix:** Wrap the message write + recordRun + touch in one transaction.

---

## 🟠 Resource leak

### 9. No storage cleanup on any failure path
`backend/src/documents/document-processing.service.ts:105`

The original file is uploaded to Supabase before `process()` runs; every `fail()` only flips the row to `'failed'`; `SupabaseService` exposes no delete method; failed docs are excluded from the quota.

**Failure:** Upload a 10MB scanned PDF with no extractable text → file stored, then `fail(extractionFailed)` marks the row `'failed'`; the 10MB object stays in the bucket forever. Because failed docs don't count toward the quota, a user can retry 50× and silently strand 500MB of orphaned storage — no cleanup job, no quota brake.

**Fix:** Add `SupabaseService.deleteFile` and remove the object on every failure path.

---

## 🟡 Latent / config-triggered

### 10. Embedding dimension hardcoded `vector(768)` vs env-configurable model
`backend/db/schema.sql:59`

`schema.sql:59,90` hardcode 768 while `GEMINI_EMBEDDING_MODEL` (`config.ts:36`) is free; the dimension is never validated at startup or per-vector (the only check is count, not dimension).

**Failure:** An operator sets a model with a different output dim (e.g. `gemini-embedding-001` → 3072). The app boots fine, but `insertChunks` casts each vector via `$N::vector` into the `vector(768)` column → Postgres raises "expected 768 dimensions" inside the transaction → every upload becomes `status='failed'`. The query path (`$2::vector` into `match_document_chunks`) throws the same → chat errors. One config change takes down indexing and retrieval opaquely.

**Fix:** Validate embedding dimension at startup against the model; or derive the column dimension from config.

### 11. `getStatusSummary` ignores the `'uploaded'` state
`backend/src/documents/documents.service.ts:124`

The summary buckets `indexed/processing/failed` only (L125-130) and never counts `'uploaded'`.

**Failure:** A row lands at `status='uploaded'` (L72) and the L92 `→ 'processing'` UPDATE fails (transient DB blip). Summary returns `total=1, indexed=0, processing=0` → `handleChat` (`messages.service.ts:74-82`) skips the `total==0` branch, sees `indexed==0`/`processing==0`, and refuses with "No approved documents uploaded" — while the sidebar (`ChatApp.tsx:35-37` treats `'uploaded'` as in-progress) shows the file spinning. Two layers disagree on what is in-progress.

**Fix:** Count `'uploaded'` into `processing` (or add a bucket); align with the frontend's notion of in-progress.

### 12. Chat guard weaker than retrieval (approval)
`backend/src/documents/documents.service.ts:118`

`getStatusSummary` counts `status` only, but `match_document_chunks` additionally requires `approval_status='approved'` (`schema.sql:124`); the guard predicate is strictly weaker than retrieval.

**Failure:** A doc with `status='indexed'` but `approval_status='pending'|'rejected'` gives `indexed>=1`, so `handleChat` admits the request, but retrieval returns 0 rows → the user gets a misleading "insufficient evidence in approved documents" refusal instead of a "pending approval" state. Latent today because `approval_status` defaults to `'approved'` and no endpoint mutates it; live as soon as an approval workflow writes the column.

**Fix:** Make the chat guard mirror the retrieval predicate (status **and** approval_status).

### 13. `db.one` null-contract violated
`backend/src/messages/messages.service.ts:48`

`DatabaseService.one<T>` returns `T|null`, but `MessagesService.add` (L48) and `ConversationsService.create` declare non-null and return it directly; `strictNullChecks:false` hides it, and callers dereference `.id`.

**Failure:** If an `INSERT … RETURNING *` ever yields zero rows (future `ON CONFLICT DO NOTHING`, RLS policy, BEFORE-INSERT trigger, schema change), `one` returns null and `userMsg.id` / `conversation.id` / `doc.id` throws `Cannot read properties of null (reading 'id')` → opaque 500. In `handleChat` it occurs after the user message is already written, leaving the request half-completed.

**Fix:** Throw a mapped domain error when `one` returns null where a row is required; enable `strictNullChecks`.

### 14. Frontend re-derives `insufficient` instead of consuming the backend value
`frontend/components/chat/ChatApp.tsx:108`

Live-send computes `insufficient = res.sources.length === 0`; the backend persists an authoritative `insufficient` (`messages.service.ts:135`) that the `ChatResponse` contract omits — two sources of truth for the same fact.

**Failure:** The day refusal logic returns one weak source (`sources.length===1`) while still persisting `insufficient:true`, a freshly-sent message computes `insufficient=false` and shows the confidence badge, but after refresh the persisted `insufficient:true` suppresses it — the identical message renders differently before and after reload. Latent today because `refuse()` always pairs `insufficient:true` with `sources:[]`.

**Fix:** Add `insufficient` to the `ChatResponse` contract and consume it instead of re-deriving.

### 15. Doc polling: no in-flight guard + full refetch
`frontend/components/chat/ChatApp.tsx:68`

A `setInterval(2500)` runs `listDocuments` (`select *`) with no in-flight guard and refetches every column when the only changing field during indexing is `status`.

**Failure:** On >2.5s latency, overlapping requests resolve out of order and a late stale response (`processing`) overwrites a newer one (`indexed`) via `setDocuments` (L70) → status flickers and re-arms polling. Also re-serializes every column (metadata jsonb, storage_path, timestamps) every 2.5s for one changing field.

**Fix:** Poll a lightweight status-summary endpoint with an in-flight guard; full-fetch once when counts settle.

---

## Verdict

- **Ship-blockers:** #1 (no auth) and #2 (quota race).
- **#3–#9** are real correctness/resource bugs reachable in normal operation.
- **#10–#15** are latent — correct today; each names the exact config/evolution trigger that activates it.

**Done right (no findings):** parameterized pgvector RPC (no SQL injection), advisory-locked chunk budget, fail-closed CORS allowlist, transactional chunk insert.
