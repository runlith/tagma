import { Context, Effect, Layer, Semaphore } from 'effect';
import { HistoryAttribution, attributeThread, restoreAttributed, type AttributionRestore } from '../HistoryAttribution';
import type { ThreadRewindInsert } from '../rewind';
import { ThreadEventJournal, type ThreadTx } from '../ThreadPorts';
import type { ThreadPortFailure } from '../ThreadBorder';
import { ThreadEntryKinds } from '../../transcript/kinds';

type Reading = { readonly attribution: HistoryAttribution; readonly through: number; readonly bytes: number };
type Entry = { readonly lock: Semaphore.Semaphore; readers: number; reading?: Reading };

export class ThreadAttributions extends Context.Service<
  ThreadAttributions,
  {
    read(threadId: string, head: number, tx?: ThreadTx): Effect.Effect<HistoryAttribution, ThreadPortFailure>;
    cut(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
    kept(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
    rewound(threadId: string, tx?: ThreadTx): Effect.Effect<readonly string[], ThreadPortFailure>;
    restore(threadId: string, plan: AttributionRestore, tx?: ThreadTx): Effect.Effect<readonly ThreadRewindInsert[], ThreadPortFailure>;
  }
>()('@runlith/agent/ThreadAttributions') {}

const RETAINED_BYTES = 16 * 1024 * 1024;

export const threadAttributionsLayer = Layer.effect(
  ThreadAttributions,
  Effect.gen(function* () {
    const journal = yield* ThreadEventJournal;
    const kinds = yield* ThreadEntryKinds;
    const entries = new Map<string, Entry>();
    let retained = 0;
    const forget = (id: string, entry: Entry): void => {
      retained -= entry.reading?.bytes ?? 0;
      entries.delete(id);
    };
    const trim = (): void => {
      if (retained <= RETAINED_BYTES) return;
      for (const [id, entry] of entries) {
        if (entry.readers === 0) forget(id, entry);
        if (retained <= RETAINED_BYTES) break;
      }
    };
    const read = (threadId: string, head: number, tx?: ThreadTx): Effect.Effect<HistoryAttribution, ThreadPortFailure> =>
      Effect.suspend(() => {
        const entry = entries.get(threadId) ?? { lock: Semaphore.makeUnsafe(1), readers: 0 };
        entries.delete(threadId);
        entries.set(threadId, entry);
        entry.readers += 1;
        return entry.lock
          .withPermit(
            Effect.gen(function* () {
              const previous = entry.reading;
              if (previous?.through === head) return previous.attribution;
              const prior =
                previous !== undefined && previous.through < head
                  ? { attribution: previous.attribution.copy(), through: previous.through }
                  : undefined;
              const attribution = yield* attributeThread(journal, kinds, threadId, head, tx, prior);
              Object.freeze(attribution);
              if (previous !== undefined && previous.through > head) return attribution;
              const bytes = attribution.retainedBytes;
              retained += bytes - (entry.reading?.bytes ?? 0);
              entry.reading = { attribution, through: head, bytes };
              trim();
              return attribution;
            }),
          )
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                entry.readers -= 1;
                if (entry.readers === 0 && entry.reading === undefined) forget(threadId, entry);
                trim();
              }),
            ),
            Effect.withSpan('ThreadAttributions.read', { attributes: { threadId, head } }),
          );
      });
    const current = (threadId: string, tx?: ThreadTx): Effect.Effect<HistoryAttribution, ThreadPortFailure> =>
      Effect.flatMap(journal.headPosition(threadId, tx), (head) => read(threadId, head, tx));
    return {
      restore: (threadId, plan, tx) => restoreAttributed(journal, kinds, threadId, plan, tx),
      read,
      cut: (threadId, tx) => Effect.map(current(threadId, tx), (attribution) => attribution.cut()),
      kept: (threadId, tx) => Effect.map(current(threadId, tx), (attribution) => attribution.kept()),
      rewound: (threadId, tx) => Effect.map(current(threadId, tx), (attribution) => attribution.rewound()),
    };
  }),
);
