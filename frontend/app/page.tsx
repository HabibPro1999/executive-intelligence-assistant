'use client';

import { useCallback, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import AuthScreen from '@/components/AuthScreen';
import ChatApp from '@/components/chat/ChatApp';
import { LoadingScreen, ErrorScreen } from '@/components/BootScreens';
import {
  getStoredConversationId,
  storeConversationId,
  clearConversationId,
} from '@/lib/localConversation';
import { createConversation, setAccessTokenGetter } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccessTokenGetter(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setConversationId(null);
      setError(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const ensureConversation = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const stored = getStoredConversationId(session.user.id);
      if (stored) {
        setConversationId(stored);
        return;
      }
      const id = await createConversation();
      storeConversationId(session.user.id, id);
      setConversationId(id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [session]);

  useEffect(() => {
    if (session) void ensureConversation();
  }, [session, ensureConversation]);

  const reset = useCallback(async () => {
    if (!session) return;
    try {
      clearConversationId(session.user.id);
      const id = await createConversation();
      storeConversationId(session.user.id, id);
      setConversationId(id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [session]);

  const signOut = useCallback(async () => {
    if (session) clearConversationId(session.user.id);
    await supabase.auth.signOut();
  }, [session]);

  if (!authReady) return <LoadingScreen />;
  if (!session) return <AuthScreen />;
  if (error) return <ErrorScreen message={error} onRetry={ensureConversation} />;
  if (!conversationId) return <LoadingScreen />;

  return (
    <ChatApp
      key={conversationId}
      conversationId={conversationId}
      userId={session.user.id}
      userEmail={session.user.email ?? ''}
      onReset={reset}
      onSignOut={signOut}
    />
  );
}
