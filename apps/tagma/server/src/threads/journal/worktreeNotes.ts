import { Clock, Context, Effect } from 'effect';
import { section } from '@runlith/held/Section';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadEventInput } from '@runlith/agent/thread/events';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { WORKTREE_ENTRY, worktreeEntryIds, type MergedAfter, type WorktreeEntry } from '../../worktrees/contract/wire/entries.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { MergeMode } from '../../worktrees/contract/wire/mergeTypes.js';
import { type WorktreeRecord, WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
const setupEntry = (record: WorktreeRecord, at: number): WorktreeEntry => ({
  type: WORKTREE_ENTRY,
  id: worktreeEntryIds.setup(record.rootId),
  event: 'setup',
  rootId: record.rootId,
  setup: record.setup,
  step: record.setupDetail?.step ?? null,
  execution: record.setupDetail?.execution ?? null,
  reason: record.setupDetail?.reason ?? null,
  occurredAt: record.createdAt.toISOString(),
  updatedAt: new Date(at).toISOString(),
});

const rootNotes = section<RootId>({
  name: 'threads/worktree-notes',
  owner: 'threads',
  rank: 200,
  key: (rootId) => rootId,
  threshold: '10 seconds',
  ceilings: {
    hold: '2 minutes',
    wait: '2 minutes',
    leaves:
      'a cut note stays unwritten in its thread; the worktree record still holds the fact and each entry has an id that a later write of the same event replaces',
  },
  external: 'none',
});

const logged =
  (subject: string) =>
  <E>(work: Effect.Effect<void, E>): Effect.Effect<void> =>
    work.pipe(Effect.catchCause((cause) => Effect.logWarning('a worktree record could not be written into a thread', { subject, cause })));

const noted = <E>(rootId: RootId, subject: string, work: Effect.Effect<void, E>) => rootNotes.enter(rootId, work).pipe(logged(subject));

export class NoteWriting extends Context.Service<
  NoteWriting,
  {
    created(threadId: string, rootId: RootId): Effect.Effect<void>;
    setup(rootId: RootId): Effect.Effect<void>;
    moved(threadId: string, rootId: RootId, operationKey: string): Effect.Effect<void>;
    merged(
      projectId: number,
      merged: {
        readonly rootId: RootId;
        readonly name: string;
        readonly branch: string;
        readonly base: string;
        readonly mode: MergeMode;
        readonly commit: string;
        readonly waitedSince?: string;
        readonly after?: MergedAfter;
      },
      threads?: readonly string[],
    ): Effect.Effect<void>;
  }
>()('tagma/threads/NoteWriting') {}

export const makeWorktreeNotes = Effect.fnUntraced(function* ({
  placedIn,
  append,
}: {
  readonly placedIn: (projectId: number, rootId: string) => Effect.Effect<readonly { readonly threadId: string }[], StoreFailure>;
  readonly append: (threadId: string, events: readonly ThreadEventInput[]) => Effect.Effect<void, ThreadBorderFailed>;
}) {
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const recordOf = (rootId: RootId) => units.read((unit) => records.byRoot(rootId, unit));
  const write = (threadId: string, entries: readonly WorktreeEntry[]) =>
    append(
      threadId,
      entries.map((entry) => ({ kind: WORKTREE_ENTRY, payload: { entry } })),
    );

  return NoteWriting.of({
    created: Effect.fnUntraced(
      function* (threadId, rootId) {
        const record = yield* recordOf(rootId);
        if (record === null) return;
        yield* write(threadId, [
          {
            type: WORKTREE_ENTRY,
            id: worktreeEntryIds.created(rootId),
            event: 'created',
            rootId,
            name: record.name,
            branch: record.branch,
            occurredAt: record.createdAt.toISOString(),
          },
          ...(record.setup === 'none' ? [] : [setupEntry(record, yield* Clock.currentTimeMillis)]),
        ]);
      },
      (work, threadId, rootId) => noted(rootId, threadId, work),
    ),
    setup: Effect.fnUntraced(
      function* (rootId) {
        const record = yield* recordOf(rootId);
        if (record === null || record.setup === 'none') return;
        const placed = yield* placedIn(record.projectId, record.rootId);
        for (const { threadId } of placed)
          yield* write(threadId, [setupEntry(record, yield* Clock.currentTimeMillis)]).pipe(logged(threadId));
      },
      (work, rootId) => noted(rootId, rootId, work),
    ),
    moved: Effect.fn('NoteWriting.moved')(
      function* (threadId, rootId, operationKey) {
        yield* write(threadId, [
          {
            type: WORKTREE_ENTRY,
            id: worktreeEntryIds.moved(operationKey),
            event: 'moved',
            rootId,
            occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          },
        ]);
      },
      (work, threadId) => logged(threadId)(work),
    ),
    merged: Effect.fnUntraced(
      function* (projectId, merged, threads) {
        const entry: WorktreeEntry = {
          type: WORKTREE_ENTRY,
          id: worktreeEntryIds.merged(merged.rootId, merged.commit),
          event: 'merged',
          ...merged,
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        const placed = threads ?? (yield* placedIn(projectId, merged.rootId)).map((one) => one.threadId);
        for (const threadId of placed) yield* write(threadId, [entry]).pipe(logged(threadId));
      },
      (work, _projectId, merged) => noted(merged.rootId, merged.rootId, work),
    ),
  });
});
