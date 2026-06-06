'use client';

import { useCallback, useEffect, useState } from 'react';
import { createConversation } from '@/lib/api';
import {
  getStoredConversationId,
  storeConversationId,
} from '@/lib/localConversation';
import ChatApp from '@/components/chat/ChatApp';
import { LoadingScreen, ErrorScreen } from '@/components/BootScreens';

export default function Home() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureConversation = useCallback(async () => {
    setError(null);
    try {
      let id = getStoredConversationId();
      if (!id) {
        id = await createConversation();
        storeConversationId(id);
      }
      setConversationId(id);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    ensureConversation();
  }, [ensureConversation]);

  // "New Conversation" — create a fresh anonymous conversation and remount.
  const reset = useCallback(async () => {
    try {
      const id = await createConversation();
      storeConversationId(id);
      setConversationId(id);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  if (error) return <ErrorScreen message={error} onRetry={ensureConversation} />;
  if (!conversationId) return <LoadingScreen />;

  return (
    <ChatApp key={conversationId} conversationId={conversationId} onReset={reset} />
  );
}
