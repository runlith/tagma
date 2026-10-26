import { Effect } from 'effect';
import { runCause } from '@runlith/agent/thread/run/runCause';
import type { NativeStorage } from '../contract/service/engine.js';
import type { ThreadInbox } from '../store/inbox.js';

export type Opener = (threadId: string, runId: string) => Effect.Effect<boolean, unknown>;

export const makeOpener = ({
  inbox,
  storage,
}: {
  readonly inbox: ThreadInbox['Service'];
  readonly storage: NativeStorage['Service'];
}): Opener =>
  Effect.fnUntraced(function* (threadId: string, runId: string) {
    if (yield* inbox.readerSpoke(threadId, runId)) return true;
    const delivered = yield* inbox.delivered(threadId, runId);
    if (delivered.length > 0) return false;
    const entries = yield* storage.threads.entriesOfRun(threadId, runId);
    return runCause(threadId, runId, delivered, entries)?.trigger.kind === 'turn';
  });
