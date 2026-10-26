import type { ConversationHit } from '@tagma/server/threads/contract/wire/conversation';

export function conversationLabel(hit: ConversationHit): string {
  const title = hit.title.trim() || 'Untitled';
  return hit.parentId === null ? title : (hit.name ?? title);
}
