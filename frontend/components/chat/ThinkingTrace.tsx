'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';

interface Props {
  steps: string[];
  done?: boolean;
}

/**
 * Animated vertical checklist of reasoning steps. Purely presentational.
 * Completed steps show a check icon; the current step (when not done) shows a
 * spinning loader. Renders nothing when there are no steps.
 */
export default function ThinkingTrace({ steps, done }: Props) {
  if (!steps || steps.length === 0) return null;

  const lastIndex = steps.length - 1;

  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => {
        const isCurrent = !done && index === lastIndex;
        return (
          <li
            key={`${step}-${index}`}
            className="flex items-center gap-2 text-xs leading-relaxed"
          >
            {isCurrent ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            )}
            <span
              className={
                isCurrent ? 'font-medium text-ink' : 'text-slate-500'
              }
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
