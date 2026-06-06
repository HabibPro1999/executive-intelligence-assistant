'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X, BrainCircuit } from 'lucide-react';
import { AssistantMode, ChatMessage, DocumentRecord } from '@/types';
import * as api from '@/lib/api';
import { clearConversationId } from '@/lib/localConversation';
import DocumentSidebar from '@/components/documents/DocumentSidebar';
import ExecutiveActionButtons from '@/components/actions/ExecutiveActionButtons';
import ChatWindow from './ChatWindow';
import ChatInput from './ChatInput';

let counter = 0;
const tmpId = () => `tmp-${++counter}-${Date.now()}`;

// Keep only renderable roles.
function normalize(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant');
}

export default function ChatApp({
  conversationId,
  onReset,
}: {
  conversationId: string;
  onReset: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          clearConversationId();
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
        { id: pendingId, role: 'assistant', content: '', pending: true },
      ]);
      setSending(true);
      setError(null);
      try {
        const res = await api.sendMessage(conversationId, text, mode);
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
                    mode,
                    insufficient: res.insufficient,
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
                  metadata: { insufficient: true },
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
      <DocumentSidebar
        documents={documents}
        onUpload={handleUpload}
        onNewConversation={onReset}
        uploading={uploading}
      />

      <main className="flex h-full flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 px-6 py-3">
          <BrainCircuit className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-sm font-semibold leading-tight text-ink">
              Executive Intelligence Assistant
            </h1>
            <p className="text-[11px] text-slate-400">
              Document-grounded RAG · answers cite your uploaded sources
            </p>
          </div>
        </header>

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
        />

        <ExecutiveActionButtons
          onAction={(mode, message) => handleSend(message, mode)}
          onDeck={handleDeck}
          disabled={sending || anyProcessing}
        />
        <ChatInput
          onSend={(t) => handleSend(t, 'qa')}
          onUpload={handleUpload}
          disabled={sending}
          busy={sending}
        />
      </main>
    </div>
  );
}
