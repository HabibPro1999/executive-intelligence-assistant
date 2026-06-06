// Offline sanity check: runs real extractors + chunking on the sample docs.
// Does NOT touch Gemini or Supabase. Run: npx ts-node verify-extraction.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExtractionService } from './src/extraction/extraction.service';
import { ChunkingService } from './src/chunking/chunking.service';

const DIR = path.join(__dirname, '..', 'sample-docs');
const files: [string, 'pdf' | 'docx' | 'xlsx'][] = [
  ['ADGM Strategic Priorities 2026.pdf', 'pdf'],
  ['Market Opportunity Analysis - Digital Assets.pdf', 'pdf'],
  ['Global Financial Centers Benchmark.xlsx', 'xlsx'],
  ['Performance Report Q2.xlsx', 'xlsx'],
  ['Regulatory Trends Summary.docx', 'docx'],
];

async function main() {
  const ext = new ExtractionService();
  const chunker = new ChunkingService();
  for (const [name, type] of files) {
    const buf = fs.readFileSync(path.join(DIR, name));
    const res = await ext.extract(type, buf);
    const chunks = chunker.chunk(res.segments);
    const sample = chunks[0]?.content.slice(0, 70).replace(/\n/g, ' ') ?? '(none)';
    console.log(
      `${name}\n  segments=${res.segments.length} chunks=${chunks.length} ` +
        `pages=${res.page_count ?? '-'} sheets=${res.sheet_count ?? '-'}\n  first: "${sample}…"\n`,
    );
  }
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
