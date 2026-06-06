import { Confidence } from '@/types';

const MAP: Record<Confidence, { label: string; cls: string }> = {
  high: { label: 'High confidence', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  medium: { label: 'Medium confidence', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  low: { label: 'Low confidence', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export default function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { label, cls } = MAP[confidence] ?? MAP.low;
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  );
}
