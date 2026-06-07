// Last opened conversation id, scoped per authenticated user.
const KEY = 'eia_conversation_id';

function scopedKey(userId: string): string {
  return `${KEY}:${userId}`;
}

export function getStoredConversationId(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(scopedKey(userId));
}

export function storeConversationId(userId: string, id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(scopedKey(userId), id);
}

export function clearConversationId(userId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(scopedKey(userId));
}
