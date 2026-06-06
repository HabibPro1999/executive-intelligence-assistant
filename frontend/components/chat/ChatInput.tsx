'use client';

import { useRef, useState, KeyboardEvent } from 'react';
import { Paperclip, Send, Loader2 } from 'lucide-react';

interface Props {
  onSend: (message: string) => void;
  onUpload: (files: FileList) => void;
  disabled?: boolean;
  busy?: boolean;
}

export default function ChatInput({ onSend, onUpload, disabled, busy }: Props) {
  const [value, setValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white p-3">
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white px-2 py-1.5 focus-within:border-brand">
        <button
          type="button"
          title="Attach PDF, DOCX, or XLSX"
          onClick={() => fileRef.current?.click()}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your uploaded documents…"
          className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="rounded-lg bg-brand p-2 text-white transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-400">
        Answers are grounded only in your uploaded documents. Enter to send,
        Shift+Enter for a new line.
      </p>
    </div>
  );
}
