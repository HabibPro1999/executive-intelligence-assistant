import {
  ChatResponse,
  Conversation,
  ChatMessage,
  DocumentRecord,
  DocumentStatusSummary,
  DeckCreateResponse,
  AssistantMode,
} from '@/types';

const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const API = `${BASE}/api`;

function absolutizeDownloadUrl<T extends DeckCreateResponse>(data: T): T {
  if (data.deck?.downloadUrl?.startsWith('/api')) {
    return {
      ...data,
      deck: {
        ...data.deck,
        downloadUrl: `${BASE}${data.deck.downloadUrl}`,
      },
    };
  }
  return data;
}

// Extracts the backend's user-facing error message when present.
async function asError(res: Response): Promise<Error> {
  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (data?.message) {
      message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    }
  } catch {
    /* ignore non-JSON error bodies */
  }
  return new Error(message);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw await asError(res);
  return res.json() as Promise<T>;
}

export async function createConversation(): Promise<string> {
  const res = await fetch(`${API}/conversations`, { method: 'POST' });
  const data = await json<{ conversationId: string }>(res);
  return data.conversationId;
}

export async function getConversation(id: string): Promise<{
  conversation: Conversation;
  messages: ChatMessage[];
  documents: DocumentRecord[];
}> {
  const res = await fetch(`${API}/conversations/${id}`, { cache: 'no-store' });
  return json(res);
}

export async function listDocuments(id: string): Promise<DocumentRecord[]> {
  const res = await fetch(`${API}/conversations/${id}/documents`, {
    cache: 'no-store',
  });
  const data = await json<{ documents: DocumentRecord[] }>(res);
  return data.documents;
}

export async function getDocumentStatusSummary(
  id: string,
): Promise<DocumentStatusSummary> {
  const res = await fetch(`${API}/conversations/${id}/documents/status-summary`, {
    cache: 'no-store',
  });
  return json(res);
}

export async function uploadDocument(
  id: string,
  file: File,
): Promise<{ documentId: string; filename: string; status: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/conversations/${id}/documents`, {
    method: 'POST',
    body: form,
  });
  return json(res);
}

export async function sendMessage(
  id: string,
  message: string,
  mode: AssistantMode,
): Promise<ChatResponse> {
  const res = await fetch(`${API}/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mode }),
  });
  return json(res);
}

export async function createDeck(
  id: string,
  message: string,
): Promise<DeckCreateResponse> {
  const res = await fetch(`${API}/conversations/${id}/decks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return absolutizeDownloadUrl(await json<DeckCreateResponse>(res));
}
