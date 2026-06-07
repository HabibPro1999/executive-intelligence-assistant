'use client';

import { useState } from 'react';
import { Source } from '@/types';
import { ChevronDown, ChevronRight, ExternalLink, FileText, Globe2 } from 'lucide-react';

function locator(s: Source): string {
  if (s.sourceType === 'web_research') {
    const parts = [s.filename || s.domain || s.url || 'Web source'];
    if (s.domain) parts.push(s.domain);
    if (s.retrievedAt) {
      parts.push(`retrieved ${new Date(s.retrievedAt).toLocaleDateString()}`);
    }
    return parts.join(' · ');
  }
  const parts: string[] = [s.filename];
  if (s.pageNumber != null) parts.push(`page ${s.pageNumber}`);
  if (s.sheetName) parts.push(`sheet "${s.sheetName}"`);
  if (s.sectionTitle) parts.push(`section "${s.sectionTitle}"`);
  return parts.join(', ');
}

export default function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 border-t border-slate-200 pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Sources used ({sources.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {sources.map((s) => (
            <li
              key={s.chunkId || s.url || s.filename}
              className="flex items-start gap-2 text-xs text-slate-600"
            >
              {s.sourceType === 'web_research' ? (
                <Globe2 className="mt-0.5 h-3 w-3 shrink-0 text-sky-500" />
              ) : (
                <FileText className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
              )}
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline"
                >
                  <span className="truncate">{locator(s)}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <span>{locator(s)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
