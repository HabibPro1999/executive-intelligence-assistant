import { Injectable } from '@nestjs/common';
import pptxgen from 'pptxgenjs';
import { DeckSlide, DeckSpec, DeckSource } from '../common/types';

const COLORS = {
  ink: '111827',
  navy: '0B1F3A',
  blue: '2457C5',
  teal: '0F766E',
  amber: 'C17A00',
  red: 'B42318',
  muted: '667085',
  line: 'D0D5DD',
  wash: 'F3F6FA',
  paleBlue: 'EAF1FF',
  paleTeal: 'E6F4F1',
  paleAmber: 'FFF4E5',
  white: 'FFFFFF',
};

const SLIDE = {
  w: 13.333,
  h: 7.5,
  mx: 0.5,
  top: 0.3,
  footer: 6.88,
};

const TYPE_LABELS: Record<DeckSlide['type'], string> = {
  title: 'Cover',
  thesis: 'Executive thesis',
  priorities: 'Strategic priorities',
  opportunity: 'Opportunity',
  benchmark: 'Positioning',
  performance: 'Performance',
  recommendations: 'Leadership agenda',
  appendix: 'Appendix',
};

@Injectable()
export class PptxDeckRenderer {
  async render(spec: DeckSpec): Promise<Buffer> {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Executive Intelligence Assistant';
    pptx.company = 'Executive Intelligence Assistant';
    pptx.subject = spec.subtitle;
    pptx.title = spec.title;
    pptx.theme = {
      headFontFace: 'Aptos Display',
      bodyFontFace: 'Aptos',
      lang: 'en-US',
    } as any;

    spec.slides.forEach((slide, index) => {
      if (slide.type === 'title' || index === 0) {
        this.addTitleSlide(pptx, spec, slide);
      } else if (slide.type === 'appendix') {
        this.addAppendixSlide(pptx, spec, slide, index);
      } else {
        this.addContentSlide(pptx, spec, slide, index);
      }
    });

    const data = await pptx.write({ outputType: 'nodebuffer' } as any);
    return Buffer.isBuffer(data) ? data : Buffer.from(data as any);
  }

  private addTitleSlide(pptx: any, spec: DeckSpec, slide: DeckSlide): void {
    const s = pptx.addSlide();
    s.background = { color: COLORS.white };

    this.block(s, 0, 0, SLIDE.w, 0.12, COLORS.navy);
    this.block(s, 0, 0.12, 0.18, SLIDE.h, COLORS.blue);
    this.block(s, 8.72, 0, 4.62, SLIDE.h, COLORS.navy);
    this.block(s, 8.72, 0, 4.62, 0.28, COLORS.blue);

    s.addText('DOCUMENT-GROUNDED STRATEGY DECK', {
      x: 0.62,
      y: 0.54,
      w: 5.9,
      h: 0.24,
      fontSize: 8,
      bold: true,
      color: COLORS.blue,
      charSpace: 1.2,
      margin: 0,
    });
    s.addText(spec.title, {
      x: 0.62,
      y: 1.18,
      w: 7.15,
      h: 1.42,
      fontSize: 30,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    s.addText(spec.subtitle || spec.audience, {
      x: 0.64,
      y: 2.74,
      w: 6.65,
      h: 0.32,
      fontSize: 11,
      bold: true,
      color: COLORS.muted,
      margin: 0,
      fit: 'shrink',
    });
    s.addText(spec.thesis || slide.keyMessage, {
      x: 0.64,
      y: 3.35,
      w: 6.7,
      h: 1.12,
      fontSize: 17,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });

    this.metricCard(s, 0.64, 5.24, 'Audience', spec.audience || 'Chief Strategy Officer');
    this.metricCard(s, 3.18, 5.24, 'Basis', 'Approved documents only');
    this.metricCard(s, 5.72, 5.24, 'Output', `${Math.max(spec.slides.length - 1, 1)} decision pages`);

    s.addText('Answer first', {
      x: 9.28,
      y: 1.08,
      w: 2.85,
      h: 0.36,
      fontSize: 20,
      bold: true,
      color: COLORS.white,
      margin: 0,
    });
    s.addText('Each page is structured around a single implication, backed by uploaded evidence and tied to executive action.', {
      x: 9.28,
      y: 1.62,
      w: 2.98,
      h: 1.2,
      fontSize: 12,
      color: 'D8E4FF',
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    this.sidePrinciple(s, 9.28, 3.32, '1', 'What changed');
    this.sidePrinciple(s, 9.28, 4.12, '2', 'Why it matters');
    this.sidePrinciple(s, 9.28, 4.92, '3', 'What to do next');
  }

  private addContentSlide(
    pptx: any,
    spec: DeckSpec,
    slide: DeckSlide,
    index: number,
  ): void {
    const s = pptx.addSlide();
    s.background = { color: COLORS.white };
    this.addHeader(s, slide, index);
    this.addSoWhat(s, slide.keyMessage);
    this.addEvidenceBullets(s, slide.bullets.slice(0, 3));
    this.addVisual(s, slide);
    this.addFooter(s, spec, slide, index);
  }

  private addAppendixSlide(
    pptx: any,
    spec: DeckSpec,
    slide: DeckSlide,
    index: number,
  ): void {
    const s = pptx.addSlide();
    s.background = { color: COLORS.white };
    this.addHeader(s, slide, index);
    s.addText('Source map', {
      x: 0.68,
      y: 1.17,
      w: 2.2,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: COLORS.blue,
      charSpace: 0.7,
      margin: 0,
    });
    const rows = [
      ['Ref', 'Document', 'Locator'],
      ...spec.sources.slice(0, 12).map((source, i) => [
        `S${i + 1}`,
        source.filename,
        this.locator(source) || 'document chunk',
      ]),
    ];
    s.addTable(rows, {
      x: 0.66,
      y: 1.55,
      w: 12.0,
      h: 4.85,
      border: { color: COLORS.line, pt: 0.5 },
      fontSize: 8,
      color: COLORS.ink,
      fill: { color: COLORS.white },
      margin: 0.07,
      autoFit: false,
    } as any);
    this.addFooter(s, spec, slide, index);
  }

  private addHeader(slide: any, deckSlide: DeckSlide, index: number): void {
    this.block(slide, 0, 0, SLIDE.w, 0.1, COLORS.navy);
    this.block(slide, 0, 0.1, SLIDE.w, 0.04, COLORS.blue);
    slide.addText(`${String(index + 1).padStart(2, '0')} | ${TYPE_LABELS[deckSlide.type]}`, {
      x: SLIDE.mx,
      y: 0.34,
      w: 3.2,
      h: 0.2,
      fontSize: 7.4,
      bold: true,
      color: COLORS.blue,
      charSpace: 0.6,
      margin: 0,
    });
    slide.addText(deckSlide.headline, {
      x: SLIDE.mx,
      y: 0.56,
      w: 12.0,
      h: 0.54,
      fontSize: 20,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    this.block(slide, SLIDE.mx, 1.18, 12.3, 0.01, COLORS.line);
  }

  private addSoWhat(slide: any, keyMessage: string): void {
    this.block(slide, 0.64, 1.42, 5.0, 1.18, COLORS.paleBlue, COLORS.blue);
    slide.addText('SO WHAT', {
      x: 0.83,
      y: 1.58,
      w: 1.1,
      h: 0.18,
      fontSize: 7.5,
      bold: true,
      color: COLORS.blue,
      charSpace: 0.7,
      margin: 0,
    });
    slide.addText(keyMessage, {
      x: 0.83,
      y: 1.84,
      w: 4.55,
      h: 0.52,
      fontSize: 13.2,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
  }

  private addEvidenceBullets(slide: any, bullets: string[]): void {
    slide.addText('Evidence and implications', {
      x: 0.67,
      y: 2.9,
      w: 3.0,
      h: 0.22,
      fontSize: 9,
      bold: true,
      color: COLORS.ink,
      margin: 0,
    });
    const padded = bullets.length ? bullets : ['Evidence is summarized in the exhibit.'];
    padded.slice(0, 3).forEach((bullet, i) => {
      const y = 3.34 + i * 0.72;
      this.block(slide, 0.66, y, 0.26, 0.26, i === 0 ? COLORS.blue : i === 1 ? COLORS.teal : COLORS.amber);
      slide.addText(String(i + 1), {
        x: 0.66,
        y: y + 0.045,
        w: 0.26,
        h: 0.12,
        fontSize: 7,
        bold: true,
        color: COLORS.white,
        align: 'center',
        margin: 0,
      });
      slide.addText(bullet, {
        x: 1.05,
        y: y - 0.02,
        w: 4.55,
        h: 0.42,
        fontSize: 10.4,
        color: COLORS.ink,
        fit: 'shrink',
        margin: 0,
        breakLine: false,
      });
    });
  }

  private addVisual(slide: any, deckSlide: DeckSlide): void {
    const x = 6.2;
    const y = 1.42;
    const w = 6.38;
    const h = 4.92;
    const visual = deckSlide.visual;

    this.block(slide, x, y, w, h, COLORS.white, COLORS.line);
    this.block(slide, x, y, w, 0.44, COLORS.navy);
    slide.addText(visual?.title || 'Executive exhibit', {
      x: x + 0.22,
      y: y + 0.13,
      w: w - 0.44,
      h: 0.16,
      fontSize: 8.5,
      bold: true,
      color: COLORS.white,
      fit: 'shrink',
      margin: 0,
    });

    if (visual?.type === 'chart' && visual.rows?.length) {
      this.addBarExhibit(slide, visual.rows.slice(0, 5), x + 0.34, y + 0.84, w - 0.68, h - 1.22);
      return;
    }

    if (visual?.type === 'table' && visual.columns?.length && visual.rows?.length) {
      this.addTableExhibit(slide, visual.columns, visual.rows.slice(0, 6), x + 0.24, y + 0.68, w - 0.48, h - 0.94);
      return;
    }

    this.addCalloutExhibit(slide, deckSlide, x + 0.34, y + 0.8, w - 0.68, h - 1.18);
  }

  private addTableExhibit(
    slide: any,
    columns: string[],
    rows: string[][],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const table = [columns.slice(0, 4), ...rows.map((row) => row.slice(0, 4))];
    slide.addTable(table, {
      x,
      y,
      w,
      h,
      border: { color: COLORS.line, pt: 0.4 },
      fontSize: 7.2,
      color: COLORS.ink,
      fill: { color: COLORS.white },
      margin: 0.04,
      autoFit: false,
    } as any);
  }

  private addBarExhibit(
    slide: any,
    rows: string[][],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const parsed = rows
      .map((row) => ({
        label: String(row[0] ?? '').slice(0, 42),
        valueLabel: String(row[1] ?? row[row.length - 1] ?? ''),
        value: this.parseNumber(String(row[1] ?? row[row.length - 1] ?? '')),
      }))
      .filter((row) => row.label);
    const max = Math.max(...parsed.map((row) => row.value || 0), 1);
    if (!parsed.some((row) => row.value > 0)) {
      this.addCalloutText(slide, rows.map((row) => row.join(' - ')).slice(0, 4), x, y, w, h);
      return;
    }
    parsed.slice(0, 5).forEach((row, i) => {
      const cy = y + i * 0.62;
      slide.addText(row.label, {
        x,
        y: cy,
        w: 2.0,
        h: 0.18,
        fontSize: 7.5,
        bold: true,
        color: COLORS.ink,
        fit: 'shrink',
        margin: 0,
      });
      this.block(slide, x + 2.25, cy + 0.02, 2.85, 0.18, COLORS.wash);
      this.block(
        slide,
        x + 2.25,
        cy + 0.02,
        Math.max(0.08, 2.85 * ((row.value || 0) / max)),
        0.18,
        [COLORS.blue, COLORS.teal, COLORS.amber, COLORS.red, COLORS.navy][i % 5],
      );
      slide.addText(row.valueLabel, {
        x: x + 5.22,
        y: cy,
        w: Math.max(0.4, w - 5.22),
        h: 0.18,
        fontSize: 7.4,
        bold: true,
        color: COLORS.muted,
        fit: 'shrink',
        margin: 0,
      });
    });
  }

  private addCalloutExhibit(
    slide: any,
    deckSlide: DeckSlide,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.block(slide, x, y, w, 1.28, COLORS.paleTeal, COLORS.teal);
    slide.addText(deckSlide.keyMessage, {
      x: x + 0.22,
      y: y + 0.2,
      w: w - 0.44,
      h: 0.78,
      fontSize: 18,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    const bullets = deckSlide.bullets.slice(0, 3);
    this.addCalloutText(slide, bullets, x, y + 1.62, w, h - 1.62);
  }

  private addCalloutText(
    slide: any,
    items: string[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const colors = [COLORS.paleBlue, COLORS.paleTeal, COLORS.paleAmber];
    items.slice(0, 3).forEach((item, i) => {
      this.block(slide, x, y + i * 0.72, w, 0.52, colors[i] ?? COLORS.wash);
      slide.addText(item, {
        x: x + 0.18,
        y: y + i * 0.72 + 0.08,
        w: w - 0.36,
        h: 0.3,
        fontSize: 8.8,
        bold: i === 0,
        color: COLORS.ink,
        fit: 'shrink',
        margin: 0,
        breakLine: false,
      });
    });
    if (!items.length) {
      slide.addText('No additional exhibit detail was generated.', {
        x,
        y,
        w,
        h,
        fontSize: 9,
        color: COLORS.muted,
        fit: 'shrink',
        margin: 0,
      });
    }
  }

  private addFooter(
    slide: any,
    spec: DeckSpec,
    deckSlide: DeckSlide,
    index: number,
  ): void {
    const footnote = this.footnote(spec.sources, deckSlide.sourceRefs);
    this.block(slide, 0.5, SLIDE.footer - 0.12, 12.25, 0.01, COLORS.line);
    slide.addText(footnote ? `Sources: ${footnote}` : 'Sources: approved document context', {
      x: 0.5,
      y: SLIDE.footer,
      w: 10.9,
      h: 0.22,
      fontSize: 6.8,
      color: COLORS.muted,
      fit: 'shrink',
      margin: 0,
    });
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: 12.18,
      y: SLIDE.footer - 0.02,
      w: 0.48,
      h: 0.22,
      fontSize: 8,
      bold: true,
      color: COLORS.blue,
      align: 'right',
      margin: 0,
    });
  }

  private metricCard(slide: any, x: number, y: number, label: string, value: string): void {
    this.block(slide, x, y, 2.18, 0.72, COLORS.wash, COLORS.line);
    slide.addText(label.toUpperCase(), {
      x: x + 0.16,
      y: y + 0.12,
      w: 1.82,
      h: 0.12,
      fontSize: 6.6,
      bold: true,
      color: COLORS.blue,
      charSpace: 0.5,
      margin: 0,
    });
    slide.addText(value, {
      x: x + 0.16,
      y: y + 0.35,
      w: 1.86,
      h: 0.18,
      fontSize: 9,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
    });
  }

  private sidePrinciple(slide: any, x: number, y: number, n: string, label: string): void {
    this.block(slide, x, y, 0.34, 0.34, COLORS.blue);
    slide.addText(n, {
      x,
      y: y + 0.06,
      w: 0.34,
      h: 0.1,
      fontSize: 8,
      bold: true,
      color: COLORS.white,
      align: 'center',
      margin: 0,
    });
    slide.addText(label, {
      x: x + 0.52,
      y: y + 0.06,
      w: 2.1,
      h: 0.16,
      fontSize: 10,
      bold: true,
      color: COLORS.white,
      margin: 0,
    });
  }

  private block(
    slide: any,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    line?: string,
  ): void {
    slide.addText('', {
      x,
      y,
      w,
      h,
      fill: { color: fill },
      line: line ? { color: line, pt: 0.5 } : { color: fill, transparency: 100 },
      margin: 0,
    } as any);
  }

  private footnote(sources: DeckSource[], refs: string[]): string {
    const labels = refs
      .map((ref) => sources.find((source) => source.chunkId === ref))
      .filter((source): source is DeckSource => Boolean(source))
      .slice(0, 3)
      .map((source) => `${source.filename}${this.locator(source) ? ` (${this.locator(source)})` : ''}`);
    return [...new Set(labels)].join('; ');
  }

  private locator(source: DeckSource): string {
    if (source.pageNumber != null) return `p. ${source.pageNumber}`;
    if (source.sheetName) return `sheet: ${source.sheetName}`;
    if (source.sectionTitle) return source.sectionTitle;
    return '';
  }

  private parseNumber(value: string): number {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Math.abs(Number(match[0])) : 0;
  }
}
