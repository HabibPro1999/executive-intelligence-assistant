import { Injectable } from '@nestjs/common';
import { ContentChunk, ExtractedSegment } from '../common/types';

// PRD §17.4 defaults: ~800 tokens per chunk, ~120 token overlap.
// We approximate tokens at ~4 characters/token (good enough for budgeting).
const CHARS_PER_TOKEN = 4;
const CHUNK_TOKENS = 800;
const OVERLAP_TOKENS = 120;
const CHUNK_CHARS = CHUNK_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

function metaKey(s: ExtractedSegment): string {
  return `${s.page_number ?? ''}|${s.sheet_name ?? ''}|${s.section_title ?? ''}`;
}

function mergedMetadata(group: ExtractedSegment[]): Record<string, unknown> {
  const metadata = { ...(group[0].metadata ?? {}) };
  const starts = group
    .map((s) => s.metadata?.row_start)
    .filter((v): v is number => typeof v === 'number');
  const ends = group
    .map((s) => s.metadata?.row_end)
    .filter((v): v is number => typeof v === 'number');
  if (starts.length && ends.length) {
    metadata.row_start = Math.min(...starts);
    metadata.row_end = Math.max(...ends);
  }
  return metadata;
}

// Split a long string into overlapping windows, preferring to break on
// paragraph/sentence boundaries near the window edge.
function splitText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
      );
      // Only honour the break if it is reasonably far into the window.
      if (breakAt > CHUNK_CHARS * 0.5) end = start + breakAt + 1;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - OVERLAP_CHARS;
    if (start < 0) start = 0;
  }
  return out.filter((s) => s.length > 0);
}

@Injectable()
export class ChunkingService {
  // Group adjacent segments that share page/sheet/section metadata, then split
  // any group that exceeds the chunk budget. Keeps citation metadata accurate
  // and avoids aggressively splitting table (Excel row-group) segments.
  chunk(segments: ExtractedSegment[]): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    let index = 0;

    let i = 0;
    while (i < segments.length) {
      const key = metaKey(segments[i]);
      const group: ExtractedSegment[] = [];
      let len = 0;
      while (
        i < segments.length &&
        metaKey(segments[i]) === key &&
        len < CHUNK_CHARS
      ) {
        group.push(segments[i]);
        len += segments[i].content.length + 1;
        i++;
      }

      const base = group[0];
      const metadata = mergedMetadata(group);
      const merged = group.map((s) => s.content).join('\n').trim();
      for (const piece of splitText(merged)) {
        chunks.push({
          chunk_index: index++,
          content: piece,
          page_number: base.page_number ?? null,
          sheet_name: base.sheet_name ?? null,
          section_title: base.section_title ?? null,
          token_count: Math.ceil(piece.length / CHARS_PER_TOKEN),
          metadata,
        });
      }
    }

    return chunks;
  }
}
