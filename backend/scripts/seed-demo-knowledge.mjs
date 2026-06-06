import fs from 'node:fs';

const API = (process.env.API_URL || 'http://localhost:8080/api').replace(/\/$/, '');
const sampleDocs = new URL('../../sample-docs/', import.meta.url);
const files = [
  ['ADGM Strategic Priorities 2026.pdf', 'application/pdf'],
  ['Market Opportunity Analysis - Digital Assets.pdf', 'application/pdf'],
  [
    'Global Financial Centers Benchmark.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  [
    'Performance Report Q2.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  [
    'Regulatory Trends Summary.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
];

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  return body;
}

async function upload(conversationId, filename, contentType) {
  const form = new FormData();
  const bytes = fs.readFileSync(new URL(filename, sampleDocs));
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  await request(`/conversations/${conversationId}/documents`, {
    method: 'POST',
    body: form,
  });
}

async function main() {
  const { conversationId } = await request('/conversations', { method: 'POST' });
  for (const [filename, contentType] of files) {
    await upload(conversationId, filename, contentType);
    console.log(`uploaded ${filename}`);
  }

  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const summary = await request(
      `/conversations/${conversationId}/documents/status-summary`,
    );
    console.log(`status ${JSON.stringify(summary)}`);
    if (summary.indexed === files.length) {
      console.log(`DEMO_KNOWLEDGE_CONVERSATION_ID=${conversationId}`);
      return;
    }
    if (summary.failed > 0) {
      throw new Error(`demo corpus indexing failed: ${JSON.stringify(summary)}`);
    }
  }

  throw new Error('demo corpus indexing timed out');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
