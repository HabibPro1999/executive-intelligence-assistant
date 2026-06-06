// Anonymous conversation id persisted in the browser (PRD §21.1).
const KEY = 'eia_conversation_id';

export function getStoredConversationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}

export function storeConversationId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, id);
}

export function clearConversationId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
