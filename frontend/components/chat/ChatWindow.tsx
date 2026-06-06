'use client';

import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/types';
import { SAMPLE_QUESTIONS } from '@/lib/modes';
import { MessagesSquare } from 'lucide-react';
import MessageBubble from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  hasDocuments: boolean;
  onSample: (q: string) => void;
}

export default function ChatWindow({ messages, hasDocuments, onSample }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="rounded-2xl bg-brand/10 p-4">
          <MessagesSquare className="h-8 w-8 text-brand" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink">
          Executive Intelligence Assistant
        </h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {hasDocuments
            ? 'Your documents are ready. Ask a question or generate an executive output below.'
            : 'Upload approved business documents (PDF, DOCX, XLSX), then ask questions or generate executive-ready briefings — grounded only in your files.'}
        </p>
        {hasDocuments && (
          <div className="mt-5 flex max-w-lg flex-wrap justify-center gap-2">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => onSample(q)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand hover:text-brand"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-8">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}
