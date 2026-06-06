import { Injectable } from '@nestjs/common';
import pptxgen from 'pptxgenjs';
import { DeckSlide, DeckSpec, DeckSource } from '../common/types';

const COLORS = {
  ink: '172033',
  muted: '5B6475',
  light: 'EEF2F6',
  accent: '1F6F78',
  accentLight: 'DDEDEF',
  white: 'FFFFFF',
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
    };

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
    s.addText('Executive Intelligence Briefing', {
      x: 0.55,
      y: 0.38,
      w: 4.8,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: COLORS.accent,
      charSpace: 1.1,
    });
    s.addText(spec.title, {
      x: 0.55,
      y: 1.28,
      w: 7.7,
      h: 1.25,
      fontSize: 32,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    s.addText(spec.thesis || slide.keyMessage, {
      x: 0.6,
      y: 2.75,
      w: 6.7,
      h: 1.2,
      fontSize: 15,
      color: COLORS.muted,
      fit: 'shrink',
      margin: 0,
      breakLine: false,
    });
    s.addText(spec.subtitle || spec.audience, {
      x: 0.6,
      y: 6.7,
      w: 8.2,
      h: 0.25,
      fontSize: 9,
      color: COLORS.muted,
      margin: 0,
    });
    this.addAccentBlock(s);
  }

  private addContentSlide(
    pptx: any,
    spec: DeckSpec,
    slide: DeckSlide,
    index: number,
  ): void {
    const s = pptx.addSlide();
    s.background = { color: COLORS.white };
    this.addHeader(s, slide.headline);
    s.addText(slide.keyMessage, {
      x: 0.62,
      y: 1.22,
      w: 5.15,
      h: 0.72,
      fontSize: 14,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
    });
    this.addBullets(s, slide.bullets.slice(0, 5), 0.82, 2.08, 5.0, 2.85);
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
    this.addHeader(s, slide.headline || 'Sources Used');
    const rows = [
      ['Source', 'Document', 'Locator'],
      ...spec.sources.slice(0, 10).map((source, i) => [
        `S${i + 1}`,
        source.filename,
        this.locator(source),
      ]),
    ];
    s.addTable(rows, {
      x: 0.65,
      y: 1.25,
      w: 12.0,
      h: 4.9,
      border: { color: 'D6DAE0', pt: 0.6 },
      fontSize: 8,
      color: COLORS.ink,
      fill: { color: COLORS.white },
      margin: 0.05,
      autoFit: false,
    } as any);
    this.addFooter(s, spec, slide, index);
  }

  private addVisual(slide: any, deckSlide: DeckSlide): void {
    const x = 6.55;
    const y = 1.28;
    const w = 6.05;
    const h = 4.85;
    const visual = deckSlide.visual;

    if (visual?.type === 'table' && visual.columns?.length && visual.rows?.length) {
      const rows = [visual.columns, ...visual.rows.slice(0, 6)];
      slide.addText(visual.title || 'Evidence table', {
        x,
        y,
        w,
        h: 0.32,
        fontSize: 10,
        bold: true,
        color: COLORS.accent,
        margin: 0,
      });
      slide.addTable(rows, {
        x,
        y: y + 0.46,
        w,
        h: h - 0.5,
        border: { color: 'D6DAE0', pt: 0.6 },
        fontSize: 7.2,
        color: COLORS.ink,
        fill: { color: COLORS.white },
        margin: 0.04,
        autoFit: false,
      } as any);
      return;
    }

    slide.addText(visual?.title || deckSlide.visual?.type || 'Evidence', {
      x,
      y,
      w,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: COLORS.accent,
      margin: 0,
    });
    slide.addText(deckSlide.keyMessage, {
      x,
      y: y + 0.55,
      w,
      h: 1.6,
      fontSize: 20,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0.1,
      fill: { color: COLORS.accentLight },
    });
    this.addBullets(slide, deckSlide.bullets.slice(0, 3), x + 0.18, y + 2.45, w - 0.3, 1.6);
  }

  private addHeader(slide: any, headline: string): void {
    slide.addText(headline, {
      x: 0.55,
      y: 0.34,
      w: 11.6,
      h: 0.55,
      fontSize: 20,
      bold: true,
      color: COLORS.ink,
      fit: 'shrink',
      margin: 0,
    });
    slide.addText('', {
      x: 0.55,
      y: 0.98,
      w: 12.1,
      h: 0.02,
      fill: { color: COLORS.light },
      margin: 0,
    });
  }

  private addBullets(
    slide: any,
    bullets: string[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    slide.addText(bullets.map((b) => `• ${b}`).join('\n'), {
      x,
      y,
      w,
      h,
      fontSize: 10.5,
      color: COLORS.ink,
      breakLine: false,
      fit: 'shrink',
      margin: 0,
      breakLineMode: false,
    } as any);
  }

  private addFooter(
    slide: any,
    spec: DeckSpec,
    deckSlide: DeckSlide,
    index: number,
  ): void {
    const footnote = this.footnote(spec.sources, deckSlide.sourceRefs);
    slide.addText(footnote ? `Sources: ${footnote}` : 'Sources: approved document context', {
      x: 0.55,
      y: 6.86,
      w: 11.4,
      h: 0.24,
      fontSize: 7,
      color: COLORS.muted,
      fit: 'shrink',
      margin: 0,
    });
    slide.addText(String(index + 1).padStart(2, '0'), {
      x: 12.2,
      y: 6.82,
      w: 0.45,
      h: 0.22,
      fontSize: 8,
      bold: true,
      color: COLORS.accent,
      align: 'right',
      margin: 0,
    });
  }

  private addAccentBlock(slide: any): void {
    slide.addText('', {
      x: 9.15,
      y: 0,
      w: 4.18,
      h: 7.5,
      fill: { color: COLORS.accent },
      margin: 0,
    });
    slide.addText('Document-grounded\nstrategy synthesis', {
      x: 9.62,
      y: 4.95,
      w: 2.85,
      h: 0.78,
      fontSize: 17,
      bold: true,
      color: COLORS.white,
      fit: 'shrink',
      margin: 0,
    });
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
}
