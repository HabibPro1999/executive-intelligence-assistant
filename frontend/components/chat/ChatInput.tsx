'use client';

import { useRef, useState, KeyboardEvent } from 'react';
import {
  FileText,
  Globe2,
  Paperclip,
  Send,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AssistantMode } from '@/types';

interface Props {
  onSend: (message: string) => void;
  onUpload: (files: FileList) => void;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  disabled?: boolean;
  busy?: boolean;
  webResearchEnabled?: boolean;
  // Voice wiring (from useSpeech, lifted in ChatApp).
  micSupported?: boolean;
  isListening?: boolean;
  onStartListening?: (onText: (t: string) => void) => void;
  onStopListening?: () => void;
  speakOn?: boolean;
  onToggleSpeak?: () => void;
}

export default function ChatInput({
  onSend,
  onUpload,
  mode,
  onModeChange,
  disabled,
  busy,
  webResearchEnabled = false,
  micSupported = false,
  isListening = false,
  onStartListening,
  onStopListening,
  speakOn = true,
  onToggleSpeak,
}: Props) {
  const [value, setValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const webMode = webResearchEnabled && mode === 'web_research';

  const toggleMic = () => {
    if (isListening) {
      onStopListening?.();
    } else {
      // Live transcript flows straight into the controlled input value.
      onStartListening?.((t) => setValue(t));
    }
  };

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    if (isListening) onStopListening?.();
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => onModeChange('qa')}
            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${
              !webMode ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Documents
          </button>
          {webResearchEnabled && (
            <button
              type="button"
              onClick={() => onModeChange('web_research')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium ${
                webMode ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Globe2 className="h-3.5 w-3.5" />
              Web Research
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleSpeak}
          title={speakOn ? 'Voice replies on — click to mute' : 'Voice replies off — click to enable'}
          aria-pressed={speakOn}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
            speakOn
              ? 'border-brand/30 bg-brand/5 text-brand'
              : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-700'
          }`}
        >
          {speakOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {speakOn ? 'Voice on' : 'Voice off'}
        </button>
      </div>
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
          placeholder={
            webMode
              ? 'Ask for live competitor, market, financial, or regulatory research...'
              : 'Ask about your uploaded documents...'
          }
          className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
        />
        {micSupported && (
          <button
            type="button"
            onClick={toggleMic}
            title={isListening ? 'Stop dictation' : 'Dictate with your voice'}
            aria-pressed={isListening}
            className={`rounded-lg p-2 transition ${
              isListening
                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
            }`}
          >
            {isListening ? (
              <MicOff className="h-5 w-5 animate-pulse" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
        )}
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
        {webMode
          ? 'Web Research uses public web sources and saves cited findings to this conversation.'
          : 'Document mode is grounded only in your uploaded documents.'}{' '}
        Enter to send, Shift+Enter for a new line.
      </p>
    </div>
  );
}
