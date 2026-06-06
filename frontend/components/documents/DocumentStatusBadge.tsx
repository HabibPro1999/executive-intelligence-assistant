import { DocumentStatus } from '@/types';
import { CheckCircle2, Loader2, AlertTriangle, Clock } from 'lucide-react';

const MAP: Record<
  DocumentStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  uploaded: { label: 'Uploaded', cls: 'bg-slate-100 text-slate-600', Icon: Clock },
  processing: {
    label: 'Processing',
    cls: 'bg-amber-100 text-amber-700',
    Icon: Loader2,
    spin: true,
  },
  indexed: {
    label: 'Indexed',
    cls: 'bg-emerald-100 text-emerald-700',
    Icon: CheckCircle2,
  },
  failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-700', Icon: AlertTriangle },
};

export default function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { label, cls, Icon, spin } = MAP[status] ?? MAP.uploaded;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      <Icon className={`h-3 w-3 ${spin ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}
