'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  X,
  BrainCircuit,
  LogOut,
  SlidersHorizontal,
  Loader2,
  Menu,
} from 'lucide-react';
import {
  AssistantMode,
  ChatMessage,
  DocumentRecord,
  UserPreferenceProfile,
} from '@/types';
import * as api from '@/lib/api';
import { useSpeech } from '@/lib/useSpeech';
import { clearConversationId } from '@/lib/localConversation';
import DocumentSidebar from '@/components/documents/DocumentSidebar';
import ExecutiveActionButtons from '@/components/actions/ExecutiveActionButtons';
import ChatWindow from './ChatWindow';
import ChatInput from './ChatInput';

let counter = 0;
const tmpId = () => `tmp-${++counter}-${Date.now()}`;
const webResearchEnabled = process.env.NEXT_PUBLIC_ENABLE_WEB_RESEARCH !== 'false';

// Keep only renderable roles.
function normalize(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant');
}

export default function ChatApp({
conversationId,
userId,
userEmail,
onReset,
onSignOut,
}: {
conversationId: string;
userId: string;
userEmail: string;
onReset: () => void;
onSignOut: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [sending, setSending] = useState(false);
const [uploading, setUploading] = useState(false);
const [error, setError] = useState<string | null>(null);
const [preferencesOpen, setPreferencesOpen] = useState(false);
const [profile, setProfile] = useState<UserPreferenceProfile | null>(null);
const [preferencesBusy, setPreferencesBusy] = useState(false);
const [inputMode, setInputMode] = useState<AssistantMode>('qa');
// Voice: speech hook + autoplay toggle (default ON for the demo).
const speech = useSpeech();
const [speakOn, setSpeakOn] = useState(true);
const pollingRef = useRef(false);

  const anyProcessing = documents.some(
    (d) => d.status === 'processing' || d.status === 'uploaded',
  );

  // Initial conversation load.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api.getConversation(conversationId);
        if (!active) return;
        setMessages(normalize(data.messages));
        setDocuments(data.documents);
      } catch (e: any) {
        if (!active) return;
        // A stale stored id (server/DB reset, expired/tampered id) returns 404.
        // Recover automatically by dropping it and starting a fresh conversation.
if (/not found/i.test(e.message)) {
clearConversationId(userId);
onReset();
return;
        }
        setError(e.message);
      }
    })();
    return () => {
      active = false;
    };
}, [conversationId]);

const loadPreferences = useCallback(async () => {
setPreferencesBusy(true);
try {
setProfile(await api.getPreferenceProfile());
} catch (e: any) {
setError(e.message);
} finally {
setPreferencesBusy(false);
}
}, []);

const resetPreferences = useCallback(async () => {
setPreferencesBusy(true);
try {
await api.resetPreferenceProfile();
setProfile(null);
} catch (e: any) {
setError(e.message);
} finally {
setPreferencesBusy(false);
}
}, []);

  // Poll document status while anything is still indexing (PRD §9.2).
  useEffect(() => {
    if (!anyProcessing) return;
    let active = true;
    const refreshIfSettled = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const summary = await api.getDocumentStatusSummary(conversationId);
        if (!active || summary.processing > 0) return;
        const docs = await api.listDocuments(conversationId);
        if (active) setDocuments(docs);
      } catch {
        /* transient; keep polling */
      } finally {
        pollingRef.current = false;
      }
    };
    void refreshIfSettled();
    const t = setInterval(refreshIfSettled, 2500);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [anyProcessing, conversationId]);

  const handleSend = useCallback(
    async (text: string, mode: AssistantMode = 'qa') => {
      if (sending) return;
      const userMsg: ChatMessage = {
        id: tmpId(),
        role: 'user',
        content: text,
        metadata: { mode },
      };
      const pendingId = tmpId();
      setMessages((m) => [
        ...m,
        userMsg,
        {
          id: pendingId,
          role: 'assistant',
          content: '',
          pending: true,
          metadata: { mode, progress: [], streaming: true },
        },
      ]);
      setSending(true);
      setError(null);
      // Unlock audio within this user gesture so the answer can be spoken on iOS,
      // then reset the streaming sentence pipeline (barge-in over any prior utterance).
      // INVARIANT: resetQueue() must run SYNCHRONOUSLY here — before the first await
      // (sendMessageStream) — so genRef is bumped ahead of any in-flight synthesize()
      // fetch resolving. The post-await stale checks in synthesize() then drop late
      // results, preventing orphaned object URLs from the prior utterance.
      if (speakOn) {
        speech.unlockAudio();
        speech.resetQueue(api.getAuthHeader);
      }
      try {
        await api.sendMessageStream(conversationId, text, mode, (event) => {
          if (event.type === 'error') throw new Error(event.message);
          // Stream each delta into the sentence pipeline (sync; prefetch + ordered
          // playback self-drive). Flush the trailing partial on 'done'.
          if (speakOn && event.type === 'delta') speech.pushStreamText(event.text);
          if (speakOn && event.type === 'done') speech.finishStream();
          setMessages((m) =>
            m.map((msg) => {
              if (msg.id !== pendingId) return msg;
              const meta = msg.metadata ?? {};
              if (event.type === 'status') {
                const progress = meta.progress ?? [];
                const steps = msg.steps ?? [];
                return {
                  ...msg,
                  steps: steps.includes(event.label)
                    ? steps
                    : [...steps, event.label],
                  metadata: {
                    ...meta,
                    streaming: true,
                    progress: progress.includes(event.label)
                      ? progress
                      : [...progress, event.label],
                  },
                };
              }
              if (event.type === 'delta') {
                return {
                  ...msg,
                  content: `${msg.content}${event.text}`,
                  metadata: { ...meta, streaming: true },
                };
              }
              if (event.type === 'sources') {
                return {
                  ...msg,
                  metadata: {
                    ...meta,
                    sources: event.sources,
                    confidence: event.confidence,
                    insufficient: event.insufficient,
                  },
                };
              }
              if (event.type === 'suggestions') {
                return { ...msg, suggestions: event.items };
              }
              if (event.type === 'chart') {
                return { ...msg, chart: event.spec };
              }
              if (event.type === 'done') {
                return {
                  ...msg,
                  id: event.messageId,
                  pending: false,
                  metadata: { ...meta, streaming: false },
                };
              }
              return msg;
            }),
          );
        });
      } catch (e: any) {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  ...msg,
                  pending: false,
                  content: `⚠️ ${e.message}`,
                  metadata: { insufficient: true, mode, streaming: false },
                }
              : msg,
          ),
        );
        setError(e.message);
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, speakOn, speech],
  );

  const handleUpload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      setError(null);
      try {
        for (const file of Array.from(files)) {
          await api.uploadDocument(conversationId, file);
        }
        setDocuments(await api.listDocuments(conversationId));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setUploading(false);
      }
    },
    [conversationId],
  );

  const handleDeck = useCallback(
    async (text: string) => {
      if (sending) return;
      const userMsg: ChatMessage = {
        id: tmpId(),
        role: 'user',
        content: text,
        metadata: { mode: 'strategy_deck' },
      };
      const pendingId = tmpId();
      setMessages((m) => [
        ...m,
        userMsg,
        { id: pendingId, role: 'assistant', content: '', pending: true },
      ]);
      setSending(true);
      setError(null);
      try {
        const res = await api.createDeck(conversationId, text);
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  id: res.messageId,
                  role: 'assistant',
                  content: res.answer,
                  metadata: {
                    sources: res.sources,
                    confidence: res.confidence,
                    mode: 'strategy_deck',
                    insufficient: res.insufficient,
                    deck: res.deck,
                  },
                }
              : msg,
          ),
        );
      } catch (e: any) {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === pendingId
              ? {
                  ...msg,
                  pending: false,
                  content: `⚠️ ${e.message}`,
                  metadata: { insufficient: true, mode: 'strategy_deck' },
                }
              : msg,
          ),
        );
        setError(e.message);
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending],
  );

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-ink">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <DocumentSidebar
        documents={documents}
        onUpload={handleUpload}
        onNewConversation={onReset}
        uploading={uploading}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex h-full min-w-0 flex-1 flex-col">
<header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 md:px-6">
<button
type="button"
title="Documents"
onClick={() => setSidebarOpen(true)}
className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
>
<Menu className="h-4 w-4" />
</button>
<BrainCircuit className="hidden h-5 w-5 text-brand md:block" />
<div className="min-w-0 flex-1">
<h1 className="text-sm font-semibold leading-tight text-ink">
Executive Intelligence Assistant
</h1>
<p className="text-[11px] text-slate-400">
{userEmail} ·{' '}
{webResearchEnabled && inputMode === 'web_research'
  ? 'web research cites public sources'
  : 'document-grounded answers cite uploaded sources'}
</p>
</div>
<button
type="button"
title="Learned preferences"
onClick={() => {
setPreferencesOpen((open) => !open);
if (!preferencesOpen) void loadPreferences();
}}
className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
>
<SlidersHorizontal className="h-4 w-4" />
</button>
<button
type="button"
title="Sign out"
onClick={onSignOut}
className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
>
<LogOut className="h-4 w-4" />
</button>
</header>

{preferencesOpen && (
<div className="border-b border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-600">
<div className="flex items-start justify-between gap-3">
<div className="min-w-0">
<p className="font-semibold text-ink">Learned preferences</p>
{preferencesBusy ? (
<p className="mt-2 flex items-center gap-2 text-slate-500">
<Loader2 className="h-3.5 w-3.5 animate-spin" />
Loading…
</p>
) : (
<p className="mt-1 whitespace-pre-wrap leading-relaxed">
{profile?.content || 'No learned preferences yet.'}
</p>
)}
</div>
<button
type="button"
onClick={resetPreferences}
disabled={preferencesBusy || !profile}
className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 font-medium text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
>
Reset
</button>
</div>
</div>
)}

        {error && (
          <div className="flex items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-700">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </span>
            <button onClick={() => setError(null)} className="hover:text-rose-900">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <ChatWindow
          messages={messages}
          hasDocuments={documents.length > 0}
          onSample={(q) => handleSend(q, 'qa')}
          onPickFollowUp={(q) => handleSend(q, 'qa')}
        />

        <ExecutiveActionButtons
          onAction={(mode, message) => handleSend(message, mode)}
          onDeck={handleDeck}
          disabled={sending}
          webResearchEnabled={webResearchEnabled}
        />
        <ChatInput
          onSend={(t) => handleSend(t, inputMode)}
          onUpload={handleUpload}
          mode={inputMode}
          onModeChange={setInputMode}
          disabled={sending}
          busy={sending}
          webResearchEnabled={webResearchEnabled}
          micSupported={speech.supported}
          isListening={speech.isListening}
          onStartListening={speech.start}
          onStopListening={speech.stop}
          speakOn={speakOn}
          onToggleSpeak={() => setSpeakOn((on) => !on)}
        />
      </main>
    </div>
  );
}
