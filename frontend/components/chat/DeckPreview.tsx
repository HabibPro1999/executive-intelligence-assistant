'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { DeckStyle } from '@/types';

export type DeckPreviewSlide = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  kind?: string;
};

// Next-Gen palette (mirrors the PPTX renderer).
const NG = {
  navy: '#061F32',
  cyan: '#00A9F4',
  teal: '#034B6F',
  steel: '#1D4769',
  titleNavy: '#1B2A4A',
  body: '#46535F',
  bodyDim: '#C9D8E6',
  line: '#D9D9D9',
  wash: '#F9FBFF',
  footer: '#7F7F7F',
};

const EYEBROW: Record<string, string> = {
  title: 'NEXT-GEN STRATEGY BRIEFING',
  thesis: 'EXECUTIVE THESIS',
  priorities: 'STRATEGIC PRIORITIES',
  opportunity: 'WHERE THE UPSIDE CONCENTRATES',
  benchmark: 'COMPETITIVE POSITIONING',
  performance: 'PERFORMANCE & EVIDENCE',
  recommendations: 'LEADERSHIP AGENDA',
  appendix: 'APPENDIX — SOURCE MAP',
};

function splitHeadBody(text: string): [string, string] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^(.{0,64}?[.:—-])\s+(.*)$/);
  if (m && m[2]) return [m[1].replace(/[\s.:—-]+$/, ''), m[2]];
  const words = clean.split(' ');
  if (words.length <= 7) return [clean, ''];
  return [words.slice(0, 7).join(' '), words.slice(7).join(' ')];
}

function PageBadge({ n, onDark }: { n: number; onDark?: boolean }) {
  return (
    <span
      className="absolute bottom-[5%] right-[4%] flex h-5 w-5 items-center justify-center rounded-full font-serif text-[10px] font-bold"
      style={{ background: NG.cyan, color: onDark ? NG.navy : '#fff' }}
    >
      {String(n).padStart(2, '0')}
    </span>
  );
}

function SoWhatBanner({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div
      className="absolute bottom-[9%] left-[5%] right-[5%] flex items-center gap-3 px-3 py-2"
      style={{ background: NG.cyan }}
    >
      <span className="h-full w-1 shrink-0" style={{ background: NG.navy }} />
      <span className="font-serif text-[8px] font-bold tracking-wider" style={{ color: NG.navy }}>
        SO WHAT
      </span>
      <span className="line-clamp-2 font-serif text-[11px] font-bold leading-snug text-white">
        {text}
      </span>
    </div>
  );
}

// ---- archetype stages -------------------------------------------------------

function NgCover({ slide }: { slide: DeckPreviewSlide }) {
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: NG.navy }}>
      {/* faint plexus hint in the navy frame */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 88% 30%, rgba(0,169,244,0.22), transparent 38%), radial-gradient(circle at 70% 92%, rgba(0,169,244,0.14), transparent 30%)',
        }}
      />
      <div className="absolute left-0 top-0 h-[84%] w-[81%] bg-white">
        <div className="absolute right-0 top-0 h-full w-[3px]" style={{ background: NG.cyan }} />
        <div className="flex h-full flex-col justify-center px-[8%]">
          <p className="font-serif text-[9px] font-bold tracking-[0.18em]" style={{ color: NG.teal }}>
            {EYEBROW.title}
          </p>
          <h2
            className="mt-3 font-serif text-2xl font-bold leading-tight"
            style={{ color: NG.titleNavy }}
          >
            {slide.title}
          </h2>
          {slide.subtitle && (
            <p className="mt-2 font-serif text-base font-bold" style={{ color: NG.cyan }}>
              {slide.subtitle}
            </p>
          )}
          <div className="mt-4 h-[3px] w-16" style={{ background: NG.cyan }} />
          <p className="mt-2 text-[9px] font-semibold tracking-wide" style={{ color: NG.steel }}>
            GROUNDED IN APPROVED DOCUMENTS
          </p>
          <p className="font-serif text-[11px]" style={{ color: NG.titleNavy }}>
            Confidential
          </p>
        </div>
      </div>
    </div>
  );
}

function NgStatement({ slide, n }: { slide: DeckPreviewSlide; n: number }) {
  const statement = slide.subtitle || slide.title;
  const bullets = (slide.bullets ?? []).slice(0, 3);
  return (
    <div className="relative h-full w-full overflow-hidden px-[6%] py-[7%]" style={{ background: NG.navy }}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 85% 55%, rgba(0,169,244,0.16), transparent 40%)',
        }}
      />
      <div className="absolute left-0 top-0 h-full w-[4px]" style={{ background: NG.cyan }} />
      <div className="relative">
        <p className="font-serif text-[9px] font-bold tracking-[0.18em]" style={{ color: NG.cyan }}>
          {EYEBROW.thesis}
        </p>
        <h2 className="mt-3 font-serif text-xl font-bold leading-snug text-white">{statement}</h2>
        <div className="mt-4 h-[3px] w-14" style={{ background: NG.cyan }} />
        <ul className="mt-4 space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1 h-2 w-2 shrink-0" style={{ background: NG.cyan }} />
              <span className="text-[11px]" style={{ color: NG.bodyDim }}>
                {b}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <PageBadge n={n} onDark />
    </div>
  );
}

function NgContent({ slide, n }: { slide: DeckPreviewSlide; n: number }) {
  const kind = slide.kind || 'content';
  const eyebrow = EYEBROW[kind] || 'STRATEGIC INSIGHT';
  const bullets = (slide.bullets ?? []).slice(0, kind === 'priorities' ? 3 : 4);
  const isCards = kind === 'priorities';

  return (
    <div className="relative h-full w-full overflow-hidden bg-white px-[5%] pt-[5%]">
      <p className="font-serif text-[9px] font-bold tracking-[0.16em]" style={{ color: NG.teal }}>
        {eyebrow}
      </p>
      <h2 className="mt-1.5 font-serif text-lg font-bold leading-tight" style={{ color: NG.titleNavy }}>
        {slide.title}
      </h2>
      <div className="relative mt-2 h-px w-full" style={{ background: NG.line }}>
        <span className="absolute left-0 top-0 h-[3px] w-12" style={{ background: NG.cyan }} />
      </div>

      {isCards ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(bullets.length ? bullets : ['']).map((b, i) => {
            const [head, body] = splitHeadBody(b);
            return (
              <div key={i} className="relative rounded-sm p-2" style={{ background: NG.wash }}>
                <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: NG.cyan }} />
                <div
                  className="mb-1.5 mt-1 flex h-6 w-6 items-center justify-center rounded-full font-serif text-[11px] font-bold text-white"
                  style={{ background: NG.cyan }}
                >
                  {i + 1}
                </div>
                <p className="font-serif text-[11px] font-bold leading-snug" style={{ color: NG.steel }}>
                  {head}
                </p>
                {body && (
                  <p className="mt-1 text-[9px] leading-snug" style={{ color: NG.body }}>
                    {body}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1 h-2 w-2 shrink-0" style={{ background: NG.cyan }} />
              <span className="text-[11px] leading-snug" style={{ color: NG.titleNavy }}>
                {b}
              </span>
            </li>
          ))}
        </ul>
      )}

      <SoWhatBanner text={slide.subtitle} />
      <PageBadge n={n} />
    </div>
  );
}

function NextGenStage({ slide, index }: { slide: DeckPreviewSlide; index: number }) {
  const kind = slide.kind || 'content';
  if (kind === 'title') return <NgCover slide={slide} />;
  if (kind === 'thesis') return <NgStatement slide={slide} n={index + 1} />;
  return <NgContent slide={slide} n={index + 1} />;
}

// ---- modal ------------------------------------------------------------------

export default function DeckPreview({
  title,
  slides,
  style = 'classic',
  onClose,
  onDownload,
}: {
  title: string;
  slides: DeckPreviewSlide[];
  style?: DeckStyle;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const safeSlides = Array.isArray(slides) ? slides : [];
  const total = safeSlides.length;
  const [index, setIndex] = useState(0);
  const isNextGen = style === 'nextgen';

  const current = Math.min(index, Math.max(total - 1, 0));

  const goPrev = () => setIndex((i) => Math.max(0, Math.min(i, total - 1) - 1));
  const goNext = () => setIndex((i) => Math.min(total - 1, i + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (total === 0) return null;

  const slide = safeSlides[current];
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets : [];
  const dlClass = isNextGen
    ? 'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white'
    : 'inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand/90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Deck preview'}
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {isNextGen && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                style={{ background: NG.cyan }}
              >
                Next-Gen
              </span>
            )}
            <h3 className="min-w-0 truncate text-sm font-semibold text-ink">
              {title || 'Strategy Deck'}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className={dlClass}
                style={isNextGen ? { background: NG.navy } : undefined}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* slide stage (16:9) */}
        <div className="bg-slate-100 p-4">
          <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {isNextGen ? (
              <NextGenStage slide={slide} index={current} />
            ) : (
              <>
                <div className="flex h-full flex-col p-8">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-2xl font-semibold leading-tight text-ink">
                      {slide?.title || `Slide ${current + 1}`}
                    </h2>
                    {slide?.subtitle && (
                      <p className="mt-1 text-sm text-slate-500">{slide.subtitle}</p>
                    )}
                  </div>
                  <ul className="mt-5 flex-1 space-y-3 overflow-auto">
                    {bullets.map((b, i) => (
                      <li key={`${i}-${b}`} className="flex gap-3 text-[15px] leading-relaxed text-slate-700">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="absolute bottom-3 right-4 text-[11px] font-medium uppercase tracking-wide text-slate-300">
                  {title || 'Strategy Deck'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* footer nav */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={current === 0}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs font-medium text-slate-500">
            Slide {current + 1} of {total}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={current === total - 1}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
