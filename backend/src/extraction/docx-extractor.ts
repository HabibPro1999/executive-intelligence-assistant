import * as mammoth from 'mammoth';
import { ExtractionResult, ExtractedSegment } from '../common/types';

// Heuristic: a short line with no terminal punctuation, surrounded by blanks,
// is likely a heading. We use it as the section_title for following paragraphs.
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 90) return false;
  if (/[.:;,]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  // Title Case, ALL CAPS, or numbered heading (e.g. "1. Overview").
  return (
    /^[A-Z0-9]/.test(t) &&
    (t === t.toUpperCase() ||
      /^\d+(\.\d+)*\.?\s/.test(t) ||
      words.filter((w) => /^[A-Z]/.test(w)).length >= Math.ceil(words.length / 2))
  );
}

// Extract text from a DOCX. No page numbers exist in the format, so we attach
// detected section titles instead to keep citations meaningful.
export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const { value } = await mammoth.extractRawText({ buffer });
  const lines = value.split(/\r?\n/);

  const segments: ExtractedSegment[] = [];
  let currentSection: string | null = null;
  let para: string[] = [];

  const flush = () => {
    const content = para.join(' ').trim();
    if (content.length > 0) {
      segments.push({
        content,
        page_number: null,
        sheet_name: null,
        section_title: currentSection,
      });
    }
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      flush();
      continue;
    }
    if (looksLikeHeading(line)) {
      flush();
      currentSection = line;
      continue;
    }
    para.push(line);
  }
  flush();

  // Fallback: nothing detected, emit the whole document as one segment.
  if (segments.length === 0 && value.trim()) {
    segments.push({
      content: value.trim(),
      page_number: null,
      sheet_name: null,
      section_title: null,
    });
  }

  return { segments, page_count: null };
}
