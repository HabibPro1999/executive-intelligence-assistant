'use client';

import { Sparkles } from 'lucide-react';

interface Props {
  items: string[];
  onPick: (q: string) => void;
}

/**
 * Up to three clickable follow-up suggestion chips. Purely presentational —
 * picking a chip calls onPick with its text. Renders nothing when empty.
 */
export default function FollowUpChips({ items, onPick }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.slice(0, 3).map((item, index) => (
        <button
          key={`${item}-${index}`}
          type="button"
          onClick={() => onPick(item)}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
        >
          <Sparkles className="h-3 w-3 shrink-0 text-brand-soft" />
          <span className="truncate">{item}</span>
        </button>
      ))}
    </div>
  );
}
