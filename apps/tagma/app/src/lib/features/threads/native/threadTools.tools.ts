import { threadToolText } from '@tagma/server/threads/voice/answers';
import { THREAD_OPERATION_IDS } from '@tagma/server/threads/contract/wire/operations/catalog';
import type { ToolKind } from '@runlith/chat-ui/EntryKinds.svelte';

export const tools: readonly ToolKind[] = THREAD_OPERATION_IDS.map((name) => ({
  name,
  modelText: (output) => threadToolText(output as Parameters<typeof threadToolText>[0]),
}));
