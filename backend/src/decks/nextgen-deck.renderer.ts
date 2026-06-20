import { Injectable } from '@nestjs/common';
import pptxgen from 'pptxgenjs';
import { DeckSlide, DeckSpec, DeckSource } from '../common/types';
import { MESH_DATA_URL } from './nextgen-deck.assets';

// =============================================================================
// Next-Gen deck renderer
// -----------------------------------------------------------------------------
// Visual language reverse-engineered from the Apparel Group reference deck
// (PowerPoint theme "1_Dark", a tier-one consulting build) via a 28-agent
// per-slide analysis. Signature traits captured here:
//   - Two masters: DARK #061F32 (cover / dividers / closing) and LIGHT #FFFFFF
//     (all body slides), with bright cyan #00A9F4 as the one accent.
//   - Georgia serif headlines (editorial "Bower"-style voice), thin hairline
//     rule beneath; steel-blue / teal eyebrows and labels.
//   - Cyan is rationed: accents, big numbers, and the single "so-what" banner.
//   - Cyan square bullets, numbered cards, big serif numerals, cyan page badge,
//     navy-header / zebra comps tables.
// Consumes the SAME DeckSpec as the classic renderer — content stays
// document-grounded and identical; only the visual treatment differs.
// =============================================================================

// Palette (hex without '#'), lifted from the synthesized design system.
const C = {
  navy: '061F32', // dark master background
  navyHdr: '0E1E3D', // table header navy
  processNavy: '002060',
  cyan: '00A9F4', // signature accent / so-what
  statCyan: '00A7F2', // big-number cyan
  blue: '1F40E6', // secondary accent
  investorBlue: '2F7ED8',
  steel: '1D4769', // headers / inline labels
  teal: '034B6F', // eyebrow / kicker
  titleNavy: '1B2A4A', // headline ink
  ink: '11151C', // near-black body lead
  body: '46535F', // body grey
  bodyDim: 'C9D8E6', // body on dark
  white: 'FFFFFF',
  line: 'D9D9D9', // hairline rule
  linePale: 'CBD5E8',
  wash: 'F9FBFF', // card tint
  band: 'EEF3F8', // row band
  zebra: 'F4F7FC', // zebra row
  intro: 'EAF0FA', // intro / callout tint
  footer: '7F7F7F',
} as const;

// Georgia ≈ McKinsey "Bower" serif (headlines, numbers, banner); Arial ≈
// "McKinsey Sans" (body) — the two dominant typefaces in the source file.
const FONT_HEAD = 'Georgia';
const FONT_BODY = 'Arial';

const SLIDE = {
  w: 13.333,
  h: 7.5,
  mx: 0.6, // left/right spine (source master = 0.607in)
  contentW: 12.13,
  bannerY: 5.66,
  footerY: 7.06,
};

// Teal ALL-CAPS eyebrow above each light-slide headline.
const EYEBROW: Record<DeckSlide['type'], string> = {
  title: 'NEXT-GEN STRATEGY BRIEFING',
  thesis: 'EXECUTIVE THESIS',
  priorities: 'STRATEGIC PRIORITIES',
  opportunity: 'WHERE THE UPSIDE CONCENTRATES',
  benchmark: 'COMPETITIVE POSITIONING',
  performance: 'PERFORMANCE & EVIDENCE',
  recommendations: 'LEADERSHIP AGENDA',
  appendix: 'APPENDIX — SOURCE MAP',
};

@Injectable()
export class NextGenDeckRenderer {
  async render(spec: DeckSpec): Promise<Buffer> {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Executive Intelligence Assistant';
    pptx.company = 'Executive Intelligence Assistant';
    pptx.subject = spec.subtitle;
    pptx.title = spec.title;
    pptx.theme = {
      headFontFace: FONT_HEAD,
      bodyFontFace: FONT_BODY,
      lang: 'en-US',
    } as any;

    spec.slides.forEach((slide, index) => {
      if (slide.type === 'title' || index === 0) {
        this.coverSlide(pptx, spec, slide);
      } else if (slide.type === 'thesis') {
        this.statementSlide(pptx, spec, slide, index);
      } else if (slide.type === 'appendix') {
        this.appendixSlide(pptx, spec, slide, index);
      } else if (slide.type === 'priorities') {
        this.columnsSlide(pptx, spec, slide, index);
      } else if (slide.type === 'recommendations') {
        this.agendaSlide(pptx, spec, slide, index);
      } else {
        this.contentSlide(pptx, spec, slide, index);
      }
    });

    const data = await pptx.write({ outputType: 'nodebuffer' } as any);
    return Buffer.isBuffer(data) ? data : Buffer.from(data as any);
  }

  // ---------------------------------------------------------------------------
  // Cover — white content panel floating over navy (navy revealed as a right +
  // bottom frame), teal eyebrow, two-tone serif title (navy + cyan), low meta.
  // ---------------------------------------------------------------------------
  private coverSlide(pptx: any, spec: DeckSpec, slide: DeckSlide): void {
    const s = pptx.addSlide();
    s.background = { color: C.navy };

    // Plexus mesh on the navy base; the panel below covers all but the
    // right + bottom frame, where the (right-biased) mesh reads as a tech motif.
    this.mesh(s);
    // Off-white content panel; leaves a navy right (~1.37in) + bottom (~1.36in) frame.
    this.rect(s, 0, 0, 10.64, 6.14, C.white);
    // Cyan node motif in the navy frame corner (decorative, no external asset).
    this.rect(s, 10.64, 0, 0.16, 6.14, C.cyan);

    const px = 0.92; // content guide inside the white panel
    s.addText('NEXT-GEN STRATEGY BRIEFING', {
      x: px, y: 0.62, w: 9.2, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 12, bold: true, color: C.teal,
      charSpace: 2.5, margin: 0,
    });

    s.addText(spec.title, {
      x: px, y: 1.95, w: 9.3, h: 1.7,
      fontFace: FONT_HEAD, fontSize: 40, bold: true, color: C.titleNavy,
      align: 'left', valign: 'top', fit: 'shrink', margin: 0,
    });

    s.addText(spec.subtitle || spec.thesis || slide.keyMessage, {
      x: px, y: 3.7, w: 9.1, h: 1.0,
      fontFace: FONT_HEAD, fontSize: 24, bold: true, color: C.cyan,
      align: 'left', valign: 'top', fit: 'shrink', margin: 0,
    });

    this.rect(s, px, 4.95, 2.4, 0.04, C.cyan);
    s.addText(
      [
        { text: (spec.audience || 'Chief Strategy Officer').toUpperCase(), options: { color: C.titleNavy, bold: true } },
        { text: '   ·   GROUNDED IN APPROVED DOCUMENTS', options: { color: C.footer } },
      ],
      {
        x: px, y: 5.15, w: 9.3, h: 0.34,
        fontFace: FONT_BODY, fontSize: 11, charSpace: 0.8, margin: 0,
      },
    );
    s.addText('Confidential', {
      x: px, y: 5.55, w: 6, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 14, color: C.titleNavy, margin: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Statement (thesis) — dark master, oversized serif so-what, cyan underline.
  // ---------------------------------------------------------------------------
  private statementSlide(pptx: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    this.mesh(s); // subtle plexus on the right; text sits on the clean left
    this.rect(s, 0, 0, 0.16, SLIDE.h, C.cyan);

    s.addText(EYEBROW[slide.type], {
      x: SLIDE.mx, y: 1.2, w: 11.4, h: 0.3,
      fontFace: FONT_HEAD, fontSize: 12, bold: true, color: C.cyan,
      charSpace: 2.5, margin: 0,
    });

    s.addText(slide.keyMessage || slide.headline, {
      x: SLIDE.mx, y: 1.85, w: 11.8, h: 2.9,
      fontFace: FONT_HEAD, fontSize: 30, bold: true, color: C.white,
      align: 'left', valign: 'top', fit: 'shrink', margin: 0,
    });

    this.rect(s, SLIDE.mx, 4.92, 2.4, 0.05, C.cyan);

    slide.bullets.slice(0, 3).forEach((b, i) => {
      const y = 5.28 + i * 0.5;
      this.rect(s, SLIDE.mx, y + 0.07, 0.16, 0.16, C.cyan);
      s.addText(b, {
        x: SLIDE.mx + 0.34, y, w: 11.3, h: 0.42,
        fontFace: FONT_BODY, fontSize: 13, color: C.bodyDim,
        valign: 'top', fit: 'shrink', margin: 0,
      });
    });

    this.darkFooter(s, index);
  }

  // ---------------------------------------------------------------------------
  // Priorities — header + N pillar cards (cyan numbered badge) + so-what banner.
  // ---------------------------------------------------------------------------
  private columnsSlide(pptx: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    const s = pptx.addSlide();
    s.background = { color: C.white };
    const top = this.lightHeader(s, slide);

    const items = (slide.bullets.length ? slide.bullets : [slide.keyMessage]).slice(0, 3);
    const n = Math.max(items.length, 1);
    const gap = 0.36;
    const cardW = (SLIDE.contentW - gap * (n - 1)) / n;
    const contentBottom = SLIDE.bannerY - 0.28;
    const avail = contentBottom - top;
    const anyBody = items.some((it) => this.splitHeadAndBody(it)[1]);
    const cardH = Math.min(anyBody ? 2.9 : 2.4, avail);
    const cardY = top + Math.max(0, (avail - cardH) / 2); // center the card band

    items.forEach((item, i) => {
      const x = SLIDE.mx + i * (cardW + gap);
      this.rect(s, x, cardY, cardW, cardH, C.wash, C.line);
      this.rect(s, x, cardY, cardW, 0.08, C.cyan);

      // Cyan numbered disc.
      this.ellipse(s, x + 0.32, cardY + 0.42, 0.6, 0.6, C.cyan);
      s.addText(String(i + 1), {
        x: x + 0.32, y: cardY + 0.42, w: 0.6, h: 0.6,
        fontFace: FONT_HEAD, fontSize: 22, bold: true, color: C.white,
        align: 'center', valign: 'middle', margin: 0,
      });

      const [head, body] = this.splitHeadAndBody(item);
      s.addText(head, {
        x: x + 0.32, y: cardY + 1.28, w: cardW - 0.64, h: body ? 0.9 : 1.34,
        fontFace: FONT_HEAD, fontSize: 16, bold: true, color: C.steel,
        valign: 'top', fit: 'shrink', margin: 0,
      });
      if (body) {
        s.addText(body, {
          x: x + 0.32, y: cardY + 2.22, w: cardW - 0.64, h: cardH - 2.42,
          fontFace: FONT_BODY, fontSize: 12, color: C.body,
          valign: 'top', fit: 'shrink', margin: 0,
        });
      }
    });

    this.takeawayBanner(s, slide.keyMessage);
    this.lightFooter(s, spec, slide, index);
  }

  // ---------------------------------------------------------------------------
  // Recommendations — numbered agenda: big serif numerals + hairline rows.
  // ---------------------------------------------------------------------------
  private agendaSlide(pptx: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    const s = pptx.addSlide();
    s.background = { color: C.white };
    const top = this.lightHeader(s, slide);

    const items = (slide.bullets.length ? slide.bullets : [slide.keyMessage]).slice(0, 4);
    const rowTop = top + 0.1;
    const pitch = (SLIDE.bannerY - 0.3 - rowTop) / Math.max(items.length, 1); // fill the band

    items.forEach((item, i) => {
      const y = rowTop + i * pitch;
      if (i > 0) this.rect(s, SLIDE.mx, y, SLIDE.contentW, 0.012, C.line);
      s.addText(String(i + 1), {
        x: SLIDE.mx, y, w: 0.9, h: pitch,
        fontFace: FONT_HEAD, fontSize: 34, bold: true, color: C.statCyan,
        align: 'left', valign: 'middle', margin: 0,
      });
      const [head, body] = this.splitHeadAndBody(item);
      s.addText(
        [
          { text: head + (body ? '  ' : ''), options: { bold: true, color: C.steel } },
          ...(body ? [{ text: body, options: { color: C.body } }] : []),
        ],
        {
          x: SLIDE.mx + 1.0, y, w: SLIDE.contentW - 1.0, h: pitch,
          fontFace: FONT_BODY, fontSize: 14, valign: 'middle', fit: 'shrink', margin: 0,
        },
      );
    });

    this.takeawayBanner(s, slide.keyMessage);
    this.lightFooter(s, spec, slide, index);
  }

  // ---------------------------------------------------------------------------
  // Content (opportunity / benchmark / performance) — left points + exhibit.
  // ---------------------------------------------------------------------------
  private contentSlide(pptx: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    const s = pptx.addSlide();
    s.background = { color: C.white };
    const top = this.lightHeader(s, slide);

    const leftX = SLIDE.mx;
    const leftW = 5.35;
    const colTop = top + 0.05;
    const contentBottom = SLIDE.bannerY - 0.28;

    s.addText('EVIDENCE & IMPLICATIONS', {
      x: leftX, y: colTop, w: leftW, h: 0.26,
      fontFace: FONT_HEAD, fontSize: 10, bold: true, color: C.steel,
      charSpace: 1.5, margin: 0,
    });

    const bullets = (slide.bullets.length ? slide.bullets : ['Evidence is summarized in the exhibit.']).slice(0, 4);
    const bTop = colTop + 0.45;
    const step = Math.min(0.82, (contentBottom - bTop) / Math.max(bullets.length, 1));
    bullets.forEach((b, i) => {
      const y = bTop + i * step;
      this.rect(s, leftX, y + 0.04, 0.17, 0.17, C.cyan);
      s.addText(b, {
        x: leftX + 0.36, y: y - 0.05, w: leftW - 0.36, h: step,
        fontFace: FONT_BODY, fontSize: 12, color: C.ink,
        valign: 'top', fit: 'shrink', margin: 0,
      });
    });

    const exY = colTop - 0.04;
    this.exhibitPanel(s, slide, 6.45, exY, SLIDE.w - SLIDE.mx - 6.45, contentBottom - exY);

    this.takeawayBanner(s, slide.keyMessage);
    this.lightFooter(s, spec, slide, index);
  }

  // ---------------------------------------------------------------------------
  // Appendix — zebra source-map table, navy header.
  // ---------------------------------------------------------------------------
  private appendixSlide(pptx: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    const s = pptx.addSlide();
    s.background = { color: C.white };
    const top = this.lightHeader(s, slide);

    const head = ['Ref', 'Document', 'Locator'];
    const body = spec.sources.slice(0, 12).map((src, i) => [
      `S${i + 1}`,
      src.filename,
      this.locator(src) || 'document chunk',
    ]);
    const rows = [
      head.map((t) => this.cell(t, { bold: true, color: C.white, fill: { color: C.navyHdr } })),
      ...body.map((r, ri) =>
        r.map((t) => this.cell(t, { color: C.ink, fill: { color: ri % 2 ? C.zebra : C.white } })),
      ),
    ];

    s.addTable(rows, {
      x: SLIDE.mx, y: top + 0.1, w: SLIDE.contentW,
      colW: [1.1, 7.2, SLIDE.contentW - 8.3],
      rowH: 0.42,
      border: { type: 'solid', color: C.line, pt: 0.5 },
      fontFace: FONT_BODY, fontSize: 9.5, valign: 'middle', margin: 0.06, autoPage: false,
    } as any);

    this.lightFooter(s, spec, slide, index);
  }

  // ===========================================================================
  // Shared building blocks
  // ===========================================================================

  // Teal eyebrow + serif headline + hairline rule (with a short cyan tick).
  // The headline box is tall and BOTTOM-aligned so 1- and 2-line headlines both
  // sit just above the rule and never collide with it. Returns the y where body
  // content should begin (so layouts adapt to a consistent rule position).
  private lightHeader(s: any, slide: DeckSlide): number {
    s.addText(EYEBROW[slide.type], {
      x: SLIDE.mx, y: 0.4, w: SLIDE.contentW, h: 0.24,
      fontFace: FONT_HEAD, fontSize: 10, bold: true, color: C.teal,
      charSpace: 2, margin: 0,
    });
    s.addText(slide.headline, {
      x: SLIDE.mx, y: 0.62, w: SLIDE.contentW, h: 1.0,
      fontFace: FONT_HEAD, fontSize: 25, bold: true, color: C.titleNavy,
      valign: 'bottom', fit: 'shrink', margin: 0,
    });
    const ruleY = 1.68;
    this.rect(s, SLIDE.mx, ruleY, SLIDE.contentW, 0.013, C.line);
    this.rect(s, SLIDE.mx, ruleY - 0.005, 1.0, 0.03, C.cyan); // brand tick
    return ruleY + 0.27;
  }

  // The signature bright-cyan so-what banner near the slide foot.
  private takeawayBanner(s: any, message: string): void {
    if (!message?.trim()) return;
    const y = SLIDE.bannerY;
    this.rect(s, SLIDE.mx, y, SLIDE.contentW, 0.66, C.cyan);
    this.rect(s, SLIDE.mx, y, 0.1, 0.66, C.navy);
    s.addText('SO WHAT', {
      x: SLIDE.mx + 0.26, y: y, w: 1.2, h: 0.66,
      fontFace: FONT_HEAD, fontSize: 9, bold: true, color: C.navy,
      charSpace: 1.5, valign: 'middle', margin: 0,
    });
    s.addText(message, {
      x: SLIDE.mx + 1.5, y: y, w: SLIDE.contentW - 1.8, h: 0.66,
      fontFace: FONT_HEAD, fontSize: 14, bold: true, color: C.white,
      valign: 'middle', fit: 'shrink', margin: 0,
    });
  }

  // Right-hand exhibit: chart, table, or callout depending on the spec.
  private exhibitPanel(s: any, slide: DeckSlide, x: number, y: number, w: number, h: number): void {
    const visual = slide.visual;
    this.rect(s, x, y, w, h, C.white, C.line);
    this.rect(s, x, y, w, 0.42, C.navyHdr);
    s.addText((visual?.title || 'Executive exhibit').toUpperCase(), {
      x: x + 0.22, y, w: w - 0.44, h: 0.42,
      fontFace: FONT_HEAD, fontSize: 9.5, bold: true, color: C.white,
      charSpace: 1, valign: 'middle', fit: 'shrink', margin: 0,
    });

    const ix = x + 0.26;
    const iy = y + 0.62;
    const iw = w - 0.52;
    const ih = h - 0.86;

    if (visual?.type === 'chart' && visual.rows?.length) {
      this.barExhibit(s, visual.rows.slice(0, 6), ix, iy, iw, ih);
      return;
    }
    if (visual?.type === 'table' && visual.columns?.length && visual.rows?.length) {
      this.tableExhibit(s, visual.columns, visual.rows.slice(0, 7), ix, iy, iw, ih);
      return;
    }
    this.calloutExhibit(s, slide.bullets.slice(0, 3), ix, iy, iw, ih);
  }

  private barExhibit(s: any, rows: string[][], x: number, y: number, w: number, h: number): void {
    const parsed = rows
      .map((r) => ({
        label: String(r[0] ?? '').slice(0, 40),
        valueLabel: String(r[1] ?? r[r.length - 1] ?? ''),
        value: this.parseNumber(String(r[1] ?? r[r.length - 1] ?? '')),
      }))
      .filter((r) => r.label);
    const max = Math.max(...parsed.map((r) => r.value || 0), 1);
    if (!parsed.some((r) => r.value > 0)) {
      this.calloutExhibit(s, rows.map((r) => r.join(' — ')).slice(0, 4), x, y, w, h);
      return;
    }
    const n = Math.min(parsed.length, 6);
    const pitch = h / n; // distribute rows to fill the panel
    const barH = Math.min(0.28, pitch * 0.4);
    const labelW = 1.85;
    const trackW = w - labelW - 0.95;
    const palette = [C.cyan, C.blue, C.steel, C.investorBlue, C.navy];
    parsed.slice(0, 6).forEach((r, i) => {
      const barY = y + i * pitch + (pitch - barH) / 2; // bar centered in its band
      const txtY = y + i * pitch + (pitch - 0.22) / 2;
      s.addText(r.label, {
        x, y: txtY, w: labelW, h: 0.22,
        fontFace: FONT_BODY, fontSize: 8.5, bold: true, color: C.steel,
        valign: 'middle', fit: 'shrink', margin: 0,
      });
      this.rect(s, x + labelW, barY, trackW, barH, C.band);
      this.rect(s, x + labelW, barY, Math.max(0.06, trackW * ((r.value || 0) / max)), barH, palette[i % palette.length]);
      s.addText(r.valueLabel, {
        x: x + labelW + trackW + 0.08, y: txtY, w: 0.87, h: 0.22,
        fontFace: FONT_HEAD, fontSize: 9, bold: true, color: C.statCyan,
        valign: 'middle', fit: 'shrink', margin: 0,
      });
    });
  }

  private tableExhibit(s: any, columns: string[], rows: string[][], x: number, y: number, w: number, h: number): void {
    const cols = columns.slice(0, 4);
    // Pale column-header (the panel already carries the navy title bar, so we
    // avoid stacking two dark bands). Body rows zebra-striped.
    const table = [
      cols.map((c) => this.cell(c, { bold: true, color: C.steel, fill: { color: C.band } })),
      ...rows.map((r, ri) =>
        r.slice(0, 4).map((c) => this.cell(String(c), { color: C.ink, fill: { color: ri % 2 ? C.zebra : C.white } })),
      ),
    ];
    s.addTable(table, {
      x, y, w, h,
      rowH: h / table.length, // fill the panel height
      border: { type: 'solid', color: C.line, pt: 0.4 },
      fontFace: FONT_BODY, fontSize: 9, valign: 'middle', margin: 0.05, autoPage: false,
    } as any);
  }

  private calloutExhibit(s: any, items: string[], x: number, y: number, w: number, h: number): void {
    const list = items.filter(Boolean).slice(0, 3);
    if (!list.length) {
      s.addText('Evidence is summarized in the narrative.', {
        x, y, w, h, fontFace: FONT_BODY, fontSize: 10, italic: true, color: C.body,
        valign: 'top', margin: 0,
      });
      return;
    }
    const cardH = (h - (list.length - 1) * 0.18) / list.length; // fill the panel
    list.forEach((item, i) => {
      const cy = y + i * (cardH + 0.18);
      this.rect(s, x, cy, w, cardH, C.intro);
      this.rect(s, x, cy, 0.08, cardH, C.cyan);
      s.addText(item, {
        x: x + 0.24, y: cy, w: w - 0.42, h: cardH,
        fontFace: FONT_BODY, fontSize: 11, bold: i === 0, color: C.ink,
        valign: 'middle', fit: 'shrink', margin: 0,
      });
    });
  }

  private lightFooter(s: any, spec: DeckSpec, slide: DeckSlide, index: number): void {
    this.rect(s, SLIDE.mx, SLIDE.footerY - 0.1, SLIDE.contentW, 0.012, C.line);
    const note = this.footnote(spec.sources, slide.sourceRefs);
    s.addText(note ? `Sources: ${note}` : 'Confidential · Grounded in approved documents', {
      x: SLIDE.mx, y: SLIDE.footerY, w: SLIDE.contentW - 0.8, h: 0.24,
      fontFace: FONT_BODY, fontSize: 7.5, color: C.footer, valign: 'middle', fit: 'shrink', margin: 0,
    });
    this.pageBadge(s, index, C.cyan, C.white);
  }

  private darkFooter(s: any, index: number): void {
    s.addText('Confidential · Grounded in approved documents', {
      x: SLIDE.mx, y: SLIDE.footerY, w: SLIDE.contentW - 0.8, h: 0.24,
      fontFace: FONT_BODY, fontSize: 7.5, color: C.bodyDim, valign: 'middle', margin: 0,
    });
    this.pageBadge(s, index, C.cyan, C.navy);
  }

  private pageBadge(s: any, index: number, fill: string, fg: string): void {
    const d = 0.34;
    const x = SLIDE.w - SLIDE.mx - d;
    const y = SLIDE.footerY - 0.04;
    this.ellipse(s, x, y, d, d, fill);
    s.addText(String(index + 1).padStart(2, '0'), {
      x, y, w: d, h: d,
      fontFace: FONT_HEAD, fontSize: 9, bold: true, color: fg,
      align: 'center', valign: 'middle', margin: 0,
    });
  }

  // ----- low-level primitives ------------------------------------------------

  private rect(s: any, x: number, y: number, w: number, h: number, fill: string, line?: string): void {
    s.addShape('rect', {
      x, y, w, h,
      fill: { color: fill },
      line: line ? { color: line, width: 0.75 } : { type: 'none' },
    });
  }

  private ellipse(s: any, x: number, y: number, w: number, h: number, fill: string): void {
    s.addShape('ellipse', { x, y, w, h, fill: { color: fill }, line: { type: 'none' } });
  }

  // Full-bleed plexus-mesh texture (transparent PNG) for dark slides.
  private mesh(s: any): void {
    s.addImage({ data: MESH_DATA_URL, x: 0, y: 0, w: SLIDE.w, h: SLIDE.h });
  }

  private cell(text: string, options: Record<string, unknown>) {
    return { text, options: { fontFace: FONT_BODY, ...options } };
  }

  // ----- text helpers --------------------------------------------------------

  // Split "Lead: detail" / "Lead — detail" into [head, body] on a REAL delimiter
  // only (and only when the body is a couple words or more). With no delimiter
  // the whole string is the head — never an orphaned trailing word or two.
  private splitHeadAndBody(text: string): [string, string] {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    const m = clean.match(/^(.{3,72}?)\s*[:—–]\s+(.+)$/);
    if (m && m[2] && m[2].split(' ').length >= 2) {
      return [m[1].replace(/[\s:—–-]+$/, ''), m[2]];
    }
    return [clean, ''];
  }

  private footnote(sources: DeckSource[], refs: string[]): string {
    const labels = (refs || [])
      .map((ref) => sources.find((src) => src.chunkId === ref))
      .filter((src): src is DeckSource => Boolean(src))
      .slice(0, 3)
      .map((src) => `${src.filename}${this.locator(src) ? ` (${this.locator(src)})` : ''}`);
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
