'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { Download, Eye, FileSliders, Loader2 } from 'lucide-react';
import { ChatMessage, DeckSummary } from '@/types';
import { downloadDeck } from '@/lib/api';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import SourceList from './SourceList';
import ThinkingTrace from './ThinkingTrace';
import FollowUpChips from './FollowUpChips';
import ChartBlock from './ChartBlock';
import DeckPreview from './DeckPreview';

function ProgressList({
  steps,
  mode,
}: {
  steps?: string[];
  mode?: NonNullable<ChatMessage['metadata']>['mode'];
}) {
  const items = steps?.length
    ? steps
    : [
        mode === 'web_research'
          ? 'Searching public web sources'
          : 'Analyzing approved documents',
      ];

  return (
    <div className="space-y-1.5 text-xs text-slate-500">
      {items.map((step, index) => {
        const active = index === items.length - 1;
        return (
          <div key={`${step}-${index}`} className="flex items-center gap-2">
            {active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
            <span>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

function DeckCard({ deck }: { deck: DeckSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const previewSlides = deck.previewSlides ?? [];
  const canPreview = previewSlides.length > 0;

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadDeck(deck);
    } catch (err: any) {
      setError(err.message || 'Download failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand">
            <FileSliders className="h-4 w-4" />
            Strategy Deck
          </div>
          <h3 className="mt-1 text-sm font-semibold text-ink">{deck.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{deck.thesis}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canPreview && (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
          )}
          <button
            type="button"
            onClick={download}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            PPTX
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      {previewOpen && canPreview && (
        <DeckPreview
          title={deck.title}
          slides={previewSlides}
          onClose={() => setPreviewOpen(false)}
          onDownload={download}
        />
      )}
      <div className="space-y-1">
        {deck.slides.slice(0, 8).map((slide, i) => (
          <div key={`${slide.type}-${i}`} className="flex gap-2 text-xs">
            <span className="w-5 shrink-0 text-slate-400">{i + 1}</span>
            <span className="font-medium text-slate-700">{slide.headline}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MessageBubble({
  message,
  onPickFollowUp,
}: {
  message: ChatMessage;
  onPickFollowUp?: (q: string) => void;
}) {
  const isUser = message.role === 'user';
  const meta = message.metadata;
  const streaming = !!meta?.streaming;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm">
        {message.pending && !message.content ? (
          message.steps?.length ? (
            <ThinkingTrace steps={message.steps} done={!streaming} />
          ) : (
            <ProgressList steps={meta?.progress} mode={meta?.mode} />
          )
        ) : (
          <>
            {message.steps?.length ? (
              <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
                <ThinkingTrace steps={message.steps} done={!streaming} />
              </div>
            ) : meta?.streaming && meta?.progress?.length ? (
              <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
                <ProgressList steps={meta.progress} mode={meta.mode} />
              </div>
            ) : null}
            {meta?.confidence && !meta?.insufficient && (
              <div className="mb-2">
                <ConfidenceBadge confidence={meta.confidence} />
              </div>
            )}
            {meta?.deck ? (
              <DeckCard deck={meta.deck} />
            ) : (
              <div className="prose prose-sm prose-slate max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-p:my-1.5 prose-table:text-xs prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
            {meta?.sources && <SourceList sources={meta.sources} />}
            {!streaming && message.chart ? (
              <ChartBlock spec={message.chart} />
            ) : null}
            {!streaming && message.suggestions?.length ? (
              <FollowUpChips
                items={message.suggestions}
                onPick={(q) => onPickFollowUp?.(q)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
