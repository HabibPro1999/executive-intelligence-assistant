'use client';

import { useState } from 'react';
import { Source } from '@/types';
import { FileText, ChevronDown, ChevronRight } from 'lucide-react';

function locator(s: Source): string {
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
              key={s.chunkId}
              className="flex items-start gap-2 text-xs text-slate-600"
            >
              <FileText className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
              <span>{locator(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
