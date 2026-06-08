import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Pool } = pg;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_DIR = path.resolve(BACKEND_DIR, '..');
const SAMPLE_DIR = path.join(REPO_DIR, 'sample-docs');
const API = (process.env.SEED_API_URL || 'http://localhost:8080/api').replace(/\/$/, '');
const PASSWORD = process.env.SEED_USER_PASSWORD || 'DemoPass!2026';

const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'DATABASE_URL',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}
const embeddingApiKey = process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY;
if (!embeddingApiKey) throw new Error('OPENAI_API_KEY or EMBEDDING_API_KEY is required');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? undefined
    : { rejectUnauthorized: false },
});

const users = [
  {
    email: 'arabic.strategist@example.test',
    name: 'Arabic Strategy Lead',
    docs: [
      'QamarPay Product Council Notes.docx',
      'Fictional Fintech KPI Dashboard.xlsx',
    ],
    preference:
      'The user prefers every answer in Arabic by default. Keep the tone concise, executive, and action-oriented. Use uploaded documents only for facts and cite sources.',
    questions: [
      'What should QamarPay prioritize next quarter?',
      'Summarize the risks around payout delays and onboarding.',
    ],
  },
  {
    email: 'strategy.operator@example.test',
    name: 'Strategy Operator',
    docs: [
      'Northstar Ledger Strategy 2027.pdf',
      'Fictional Fintech KPI Dashboard.xlsx',
    ],
    questions: [
      'Give me a concise executive summary for Northstar Ledger.',
      'Which KPI needs the most leadership attention?',
    ],
  },
  {
    email: 'finance.analyst@example.test',
    name: 'Finance Analyst',
    docs: [
      'BlueHarbor Payments Expansion Memo.pdf',
      'Meridian Vault Risk Brief.docx',
      'Fictional Fintech KPI Dashboard.xlsx',
    ],
    questions: [
      'Compare the growth and risk signals across these companies.',
      'Create a market opportunity analysis from the uploaded documents.',
    ],
  },
];

async function resetDb() {
  await pool.query(`
    drop table if exists user_preference_profiles cascade;
    drop table if exists presentation_decks cascade;
    drop table if exists assistant_runs cascade;
    drop table if exists document_chunks cascade;
    drop table if exists documents cascade;
    drop table if exists messages cascade;
    drop table if exists conversations cascade;
  `);
  const schema = fs.readFileSync(path.join(BACKEND_DIR, 'db/schema.sql'), 'utf8');
  await pool.query(schema);
}

async function listStorageFiles(prefix = '') {
  const { data, error } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`Storage list failed: ${error.message}`);
  const files = [];
  for (const item of data || []) {
    const key = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) files.push(key);
    else files.push(...(await listStorageFiles(key)));
  }
  return files;
}

async function resetStorage() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((bucket) => bucket.name === process.env.SUPABASE_STORAGE_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(
      process.env.SUPABASE_STORAGE_BUCKET,
      { public: false },
    );
    if (error) throw new Error(`Storage bucket create failed: ${error.message}`);
    return;
  }
  const files = await listStorageFiles();
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    if (!batch.length) continue;
    const { error } = await supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET)
      .remove(batch);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}

async function deleteSeedUsers() {
  const emails = new Set(users.map((user) => user.email));
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Auth user list failed: ${error.message}`);
    for (const user of data.users || []) {
      if (!emails.has(user.email)) continue;
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) throw new Error(`Auth user delete failed: ${deleteError.message}`);
    }
    if ((data.users || []).length < 1000) break;
    page += 1;
  }
}

async function createSeedUser(seed) {
  const { data, error } = await supabase.auth.admin.createUser({
    email: seed.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: seed.name },
  });
  if (error) throw new Error(`Auth user create failed for ${seed.email}: ${error.message}`);
  return data.user;
}

async function signIn(email) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`Sign in failed for ${email}: ${error?.message || 'no session'}`);
  }
  return data.session.access_token;
}

async function request(token, route, options = {}) {
  const res = await fetch(`${API}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${route} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function upload(token, conversationId, filename) {
  const filePath = path.join(SAMPLE_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const type =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)], { type }), filename);
  await request(token, `/conversations/${conversationId}/documents`, {
    method: 'POST',
    body: form,
  });
}

async function waitForIndexing(token, conversationId, expected) {
  for (let i = 0; i < 90; i += 1) {
    const summary = await request(
      token,
      `/conversations/${conversationId}/documents/status-summary`,
    );
    if (summary.indexed === expected) return summary;
    if (summary.failed > 0) {
      throw new Error(`Indexing failed: ${JSON.stringify(summary)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`Indexing timed out for ${conversationId}`);
}

async function embed(text) {
  const baseUrl = (process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS || 768);
  if (dimensions !== 768) {
    throw new Error(`EMBEDDING_DIMENSIONS=${dimensions} does not match schema vector(768)`);
  }
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${embeddingApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: text,
      dimensions,
    }),
  });
  if (!res.ok) throw new Error(`Preference embedding failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const values = data?.data?.[0]?.embedding;
  if (!Array.isArray(values) || values.length !== dimensions) {
    throw new Error(`Preference embedding returned invalid dimension (${values?.length ?? 'missing'})`);
  }
  return `[${values.join(',')}]`;
}

async function upsertPreference(userId, content) {
  const vector = await embed(content);
  await pool.query(
    `insert into user_preference_profiles (user_id, content, embedding, metadata)
     values ($1, $2, $3::vector, $4::jsonb)
     on conflict (user_id) do update
        set content = excluded.content,
            embedding = excluded.embedding,
            metadata = excluded.metadata,
            updated_at = now()`,
    [userId, content, vector, JSON.stringify({ seeded: true })],
  );
}

async function seedUser(seed) {
  const authUser = await createSeedUser(seed);
  const token = await signIn(seed.email);
  const { conversationId } = await request(token, '/conversations', { method: 'POST' });
  for (const doc of seed.docs) await upload(token, conversationId, doc);
  await waitForIndexing(token, conversationId, seed.docs.length);
  if (seed.preference) await upsertPreference(authUser.id, seed.preference);
  for (const question of seed.questions) {
    await request(token, `/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, mode: 'qa' }),
    });
  }
  return { email: seed.email, password: PASSWORD, userId: authUser.id, conversationId };
}

async function main() {
  await import('../../sample-docs/generate.mjs');
  await resetStorage();
  await deleteSeedUsers();
  await resetDb();

  const seeded = [];
  for (const user of users) seeded.push(await seedUser(user));

  console.log('Seeded fictional demo users:');
  for (const user of seeded) {
    console.log(`${user.email} | ${user.password} | ${user.conversationId}`);
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
