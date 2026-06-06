'use client';

import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createConversation } from '@/lib/api';
import { storeConversationId } from '@/lib/localConversation';
import ChatApp from '@/components/chat/ChatApp';
import { LoadingScreen } from '@/components/BootScreens';

// Direct/shareable link to a specific conversation (PRD §31 near-term roadmap).
export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const reset = useCallback(async () => {
    const newId = await createConversation();
    storeConversationId(newId);
    router.push('/');
  }, [router]);

  if (!id) return <LoadingScreen />;

  return <ChatApp key={id} conversationId={id} onReset={reset} />;
}
