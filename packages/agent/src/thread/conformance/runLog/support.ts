import { Deferred, Effect, Schedule } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { contextChangeEntryId } from '../../../transcript/entryNames';
import { foldThreadTranscript } from '../../../transcript/eventFold';
import type { ThreadContextChange, ThreadRow } from '../../rows';
import type { ThreadTranscript } from '../../../transcript/rows';
import type { ThreadStorageHarness } from '../storagePort';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import { readThreadEvents, type ThreadEventRecord } from '../../events';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadInboxItemValues, ThreadInboxKind, ThreadInboxStorage } from '../../storage/inbox';
import type { ThreadRunStorage } from '../../storage/runs';

export function gate() {
  const reached = Deferred.makeUnsafe<void>();
  const released = Deferred.makeUnsafe<void>();
  return {
    reach: () => {
      Deferred.doneUnsafe(reached, Effect.void);
    },
    reached: Deferred.await(reached),
    release: () => {
      Deferred.doneUnsafe(released, Effect.void);
    },
    released: Deferred.await(released),
  };
}

export const transcriptOf = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, threadId: string) =>
  Effect.map(storage.aggregate.transcriptOf(threadId), (entries): readonly ThreadTranscriptEntry[] => entries ?? []);

export function contextEntries(transcript: readonly ThreadTranscriptEntry[]): readonly ThreadTranscriptEntry[] {
  return transcript.filter((entry) => entry.type === 'context-change');
}

export const stepNumbersOf = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  threadId: string,
  runId: string,
) {
  const events = yield* readThreadEvents(storage.eventLog, storage.kinds, threadId, 0, 1_000);
  return events.flatMap((event) =>
    event.kind === 'step-finished' && event.payload.context?.runId === runId ? [event.payload.context.stepNumber] : [],
  );
});

export const contextRecords = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  threadId: string,
) {
  const events = yield* readThreadEvents(storage.eventLog, storage.kinds, threadId, 0, 1_000);
  const latest = new Map<string, ThreadContextChange>();
  for (const event of events) {
    const change = event.payload.contextChange;
    if (change) latest.set(contextChangeEntryId(change.runId, change.requestId), change);
  }
  return [...latest.values()];
});

export function withInbox<TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  inbox: ThreadInboxStorage<TTx, TWrite>,
): ThreadStorageHarness<TTx, TWrite> {
  return { ...storage, inbox };
}

export function withRuns<TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  runs: (input: { ownerId: string; scope: string }) => ThreadRunStorage<TTx, TWrite>,
): ThreadStorageHarness<TTx, TWrite> {
  return { ...storage, runs };
}

export class BrokenCarryInbox<TTx, TWrite extends TTx = TTx> {
  private brokenFor: string | null = null;
  readonly faces: ThreadInboxStorage<TTx, TWrite>;

  constructor(inbox: ThreadInboxStorage<TTx, TWrite>) {
    this.faces = new Proxy(inbox as object, {
      get: (target, name, receiver) =>
        name === 'deliver'
          ? (ids: readonly string[], runId: string, tx?: TWrite) => {
              if (this.brokenFor === null || !ids.includes(this.brokenFor)) return inbox.deliver(ids, runId, tx);
              this.brokenFor = null;
              return Effect.fail(new ThreadStorageFailed({ call: 'deliver', cause: new Error('The inbox died mid-carry.') }));
            }
          : Reflect.get(target, name, receiver),
    }) as ThreadInboxStorage<TTx, TWrite>;
  }

  breakNextCarryOf(itemId: string): void {
    this.brokenFor = itemId;
  }
}

export function request(id: string, threadId: string, text: string, at: number): ThreadInboxItemValues {
  return {
    id,
    threadId,
    sender: { kind: 'host' },
    kind: 'task',
    body: { intent: 'task', text, inReplyTo: null },
    occurredAt: new Date(at).toISOString(),
  };
}

export const inboxQueued = <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  threadId: string,
  kind?: ThreadInboxKind,
) =>
  Effect.map(storage.inbox.pending(threadId), (items) =>
    items.filter((item) => item.state === 'queued' && (kind === undefined || item.kind === kind)),
  );

export const standingOf = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, id: string) =>
  Effect.map(storage.inbox.receipt(id), (item) => (item ? { state: item.state, runId: item.deliveredToRunId } : undefined));

export const until = <E, R>(check: () => Effect.Effect<boolean, E, R>) =>
  Effect.suspend(check).pipe(Effect.repeat({ while: (ready) => !ready, schedule: Schedule.spaced(10) }), Effect.asVoid);

export function foldEntries(events: readonly ThreadEventRecord[]): ThreadTranscript {
  let transcript: ThreadTranscript = [];
  for (const event of events) {
    transcript = foldThreadTranscript(transcript, {
      kind: event.kind,
      entry: event.payload.entry,
      withdrawn: event.payload.withdrawn ? { runId: event.payload.withdrawn.runId } : undefined,
      branched: event.payload.branched,
    });
  }
  return transcript;
}

export function messageText(message: Message): string {
  return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

export const spawnedThread = <TTx, TWrite extends TTx = TTx>(storage: ThreadStorageHarness<TTx, TWrite>, parent: ThreadRow) =>
  storage.aggregate.transaction((tx) => storage.aggregate.insertChild(parent.id, { ownerId: parent.ownerId, agentId: parent.agentId }, tx));
