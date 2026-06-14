'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';

export type DeckPreviewSlide = {
  title: string;
  subtitle?: string;
  bullets?: string[];
  kind?: string;
};

export default function DeckPreview({
  title,
  slides,
  onClose,
  onDownload,
}: {
  title: string;
  slides: DeckPreviewSlide[];
  onClose: () => void;
  onDownload?: () => void;
}) {
  const safeSlides = Array.isArray(slides) ? slides : [];
  const total = safeSlides.length;
  const [index, setIndex] = useState(0);

  // Clamp index defensively if the slide list shrinks across renders.
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
          <h3 className="min-w-0 truncate text-sm font-semibold text-ink">
            {title || 'Strategy Deck'}
          </h3>
          <div className="flex items-center gap-2">
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
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
