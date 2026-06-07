import {
  ChatResponse,
  Conversation,
  ChatMessage,
  DocumentRecord,
  DocumentStatusSummary,
  DeckCreateResponse,
  AssistantMode,
  DeckSummary,
  UserPreferenceProfile,
  ChatStreamEvent,
} from '@/types';

const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const API = `${BASE}/api`;
let accessTokenGetter: (() => Promise<string | null>) | null = null;

export function setAccessTokenGetter(getter: () => Promise<string | null>): void {
  accessTokenGetter = getter;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<HeadersInit> {
  const token = accessTokenGetter ? await accessTokenGetter() : null;
  return token
    ? { ...extra, Authorization: `Bearer ${token}` }
    : extra;
}

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
  const res = await fetch(`${API}/conversations`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await json<{ conversationId: string }>(res);
  return data.conversationId;
}

export async function getConversation(id: string): Promise<{
  conversation: Conversation;
  messages: ChatMessage[];
  documents: DocumentRecord[];
}> {
  const res = await fetch(`${API}/conversations/${id}`, {
    cache: 'no-store',
    headers: await authHeaders(),
  });
  return json(res);
}

export async function listDocuments(id: string): Promise<DocumentRecord[]> {
  const res = await fetch(`${API}/conversations/${id}/documents`, {
    cache: 'no-store',
    headers: await authHeaders(),
  });
  const data = await json<{ documents: DocumentRecord[] }>(res);
  return data.documents;
}

export async function getDocumentStatusSummary(
  id: string,
): Promise<DocumentStatusSummary> {
  const res = await fetch(`${API}/conversations/${id}/documents/status-summary`, {
    cache: 'no-store',
    headers: await authHeaders(),
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
    headers: await authHeaders(),
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
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, mode }),
  });
  return json(res);
}

export async function sendMessageStream(
  id: string,
  message: string,
  mode: AssistantMode,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${API}/conversations/${id}/messages/stream`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, mode }),
  });
  if (!res.ok) throw await asError(res);
  if (!res.body) throw new Error('Streaming response was empty.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeFrame = (frame: string) => {
    let eventType = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    const parsed = JSON.parse(dataLines.join('\n'));
    onEvent({ type: parsed.type ?? eventType, ...parsed } as ChatStreamEvent);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      frames.filter(Boolean).forEach(consumeFrame);
    }
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) consumeFrame(buffer.trim());
}

export async function createDeck(
  id: string,
  message: string,
): Promise<DeckCreateResponse> {
  const res = await fetch(`${API}/conversations/${id}/decks`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message }),
  });
  return absolutizeDownloadUrl(await json<DeckCreateResponse>(res));
}

export async function getPreferenceProfile(): Promise<UserPreferenceProfile | null> {
  const res = await fetch(`${API}/me/preferences`, {
    cache: 'no-store',
    headers: await authHeaders(),
  });
  const data = await json<{ profile: UserPreferenceProfile | null }>(res);
  return data.profile;
}

export async function resetPreferenceProfile(): Promise<void> {
  const res = await fetch(`${API}/me/preferences`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  await json(res);
}

export async function downloadDeck(deck: DeckSummary): Promise<void> {
  const res = await fetch(deck.downloadUrl, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw await asError(res);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const filename =
    disposition.match(/filename="([^"]+)"/)?.[1] ||
    `${deck.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'strategy-deck'}.pptx`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
