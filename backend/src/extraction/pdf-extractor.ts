import pdfParse from 'pdf-parse';
import { ExtractionResult, ExtractedSegment } from '../common/types';

// Extract text from a PDF, one segment per page so page numbers can be cited.
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pages: string[] = [];

  // pdf-parse calls this per page; we rebuild text with line breaks from the
  // text-item vertical positions, then collect one entry per page.
  function renderPage(pageData: any): Promise<string> {
    return pageData
      .getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
      .then((textContent: any) => {
        let lastY: number | undefined;
        let text = '';
        for (const item of textContent.items) {
          const y = item.transform?.[5];
          if (lastY !== undefined && y !== lastY) text += '\n';
          text += item.str;
          lastY = y;
        }
        pages.push(text);
        return text;
      });
  }

  const data = await pdfParse(buffer, {
    pagerender: renderPage,
    version: 'v2.0.550',
  });

  const segments: ExtractedSegment[] = pages
    .map((content, i) => ({
      content: content.trim(),
      page_number: i + 1,
      sheet_name: null,
      section_title: null,
    }))
    .filter((s) => s.content.length > 0);

  // Fallback: if per-page rendering yielded nothing, use the flat text.
  if (segments.length === 0 && data.text?.trim()) {
    segments.push({
      content: data.text.trim(),
      page_number: 1,
      sheet_name: null,
      section_title: null,
    });
  }

  return { segments, page_count: data.numpages ?? pages.length };
}
