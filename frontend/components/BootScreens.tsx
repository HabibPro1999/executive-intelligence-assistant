'use client';

import { Loader2, AlertTriangle, BrainCircuit } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 text-slate-500">
      <BrainCircuit className="h-8 w-8 text-brand" />
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting your secure session…
      </div>
    </div>
  );
}

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-100 px-6 text-center">
      <AlertTriangle className="h-8 w-8 text-rose-500" />
      <div>
        <p className="text-sm font-semibold text-ink">
          Could not reach the assistant backend
        </p>
        <p className="mt-1 max-w-md text-xs text-slate-500">{message}</p>
        <p className="mt-1 text-[11px] text-slate-400">
          Check that the backend is running and NEXT_PUBLIC_API_URL is set
          correctly.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-soft"
      >
        Retry
      </button>
    </div>
  );
}
