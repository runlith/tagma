import { Context, Effect } from 'effect';
import type { Message } from '@runlith/llm/schema/messages';
import { estimateThreadTokens } from '../compaction/measurement';
import { ThreadAttachments } from '../ThreadPorts';
import type { ThreadPortRefusal } from '../ThreadBorder';
import type { ThreadStorageFailed } from '../persisted';
import { pairedForProvider } from './toolPairing';

export type ThreadTailInput = {
  readonly threadId: string;
  readonly history: readonly Message[];
  readonly room: number;
  readonly attachments: Context.Service.Shape<typeof ThreadAttachments>;
};

export const threadTail = Effect.fnUntraced(function* (
  input: ThreadTailInput,
): Effect.fn.Return<readonly Message[] | null, ThreadStorageFailed | ThreadPortRefusal> {
  let from = input.history.length;
  let stored = 0;
  while (from > 0) {
    const next = stored + estimateThreadTokens([input.history[from - 1] as Message]);
    if (next > input.room) break;
    stored = next;
    from -= 1;
  }
  while (from < input.history.length) {
    const sendable = yield* input.attachments.hydrate(input.threadId, pairedForProvider(input.history.slice(from)));
    if (sendable.length > 0 && estimateThreadTokens(sendable) <= input.room) return sendable;
    from += 1;
  }
  return null;
});
