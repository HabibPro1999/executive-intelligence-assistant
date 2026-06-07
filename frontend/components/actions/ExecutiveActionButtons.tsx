'use client';

import { Search, Sparkles } from 'lucide-react';
import { EXECUTIVE_ACTIONS, STRATEGY_DECK_ACTION, WEB_RESEARCH_ACTIONS } from '@/lib/modes';
import { AssistantMode } from '@/types';

interface Props {
  onAction: (mode: AssistantMode, message: string) => void;
  onDeck: (message: string) => void;
  disabled?: boolean;
}

// Executive action buttons (PRD §16.3). Each sends a preconfigured message + mode.
export default function ExecutiveActionButtons({ onAction, onDeck, disabled }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2">
      <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
        <Sparkles className="h-3.5 w-3.5" />
        Generate:
      </span>
      {EXECUTIVE_ACTIONS.map((a) => (
        <button
          key={a.mode}
          onClick={() => onAction(a.mode, a.message)}
          disabled={disabled}
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          {a.label}
        </button>
      ))}
      <button
        onClick={() => onDeck(STRATEGY_DECK_ACTION.message)}
        disabled={disabled}
        className="rounded-full border border-brand bg-brand px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {STRATEGY_DECK_ACTION.label}
      </button>
      <span className="ml-1 flex items-center gap-1 text-xs font-medium text-slate-500">
        <Search className="h-3.5 w-3.5" />
        Web:
      </span>
      {WEB_RESEARCH_ACTIONS.map((a) => (
        <button
          key={a.label}
          onClick={() => onAction(a.mode, a.message)}
          disabled={disabled}
          className="rounded-full border border-sky-300 bg-white px-3 py-1 text-xs font-medium text-sky-700 transition hover:border-sky-500 hover:text-sky-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
