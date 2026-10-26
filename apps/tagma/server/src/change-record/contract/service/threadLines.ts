import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { recordFacts } from '../../../thread-record/facts.js';
import { namesOfHolders } from '../../record/sessions.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { ChangeRecord } from './record.js';
import { ChangeScope } from './scope.js';
import { ThreadRoots } from './threadRoots.js';
import type { RunFilesFailure } from './runFiles.js';
import type { RunFilesRead, RunSelection } from '../wire/runFiles.js';

const checkoutOf = Effect.fn('ChangeRecord.threadCheckout')(function* (selection: RunSelection) {
  const projectId = yield* (yield* ChangeScope).projectId;
  const store = yield* MachineStore;
  const rows = yield* (yield* MachineUnits).read((unit) =>
    unit.run(
      store.db
        .select({ id: recordFacts.id })
        .from(recordFacts)
        .where(and(eq(recordFacts.id, selection.threadId), eq(recordFacts.projectId, projectId)))
        .limit(1),
    ),
  );
  if (rows.length === 0)
    return yield* new GateRefusal('not-found', 'the selected thread does not belong to this project', [
      'name a thread of the current project',
    ]);
  const rootId = yield* Effect.result((yield* ThreadRoots).rootOf(selection.threadId));
  if (rootId._tag === 'Failure') return { _tag: 'unavailable' as const, unavailable: rootId.failure.message };
  if (rootId.success === null) return { _tag: 'unavailable' as const, unavailable: 'the thread has no checkout' };
  const root = yield* Effect.result((yield* FileRoots).read(RootId.make(rootId.success)));
  if (root._tag === 'Failure') return { _tag: 'unavailable' as const, unavailable: root.failure.message };
  const origin = yield* (yield* WorkingOrigins).rootOf(root.success.path);
  return { _tag: 'available' as const, checkout: { projectId, root: root.success.path, origin, git: yield* Git } };
});

const readable = <A, R>(work: Effect.Effect<A, RunFilesFailure, R>) =>
  work.pipe(
    Effect.catchTags({
      GitRefused: (cause) => Effect.fail(new GateRefusal('git-unreadable', cause.message, ['use a readable checkout'])),
      GitUnreadable: (cause) => Effect.fail(new GateRefusal('git-unreadable', cause.message, ['use a readable checkout'])),
      GitAnswerInvalid: (cause) => Effect.fail(new GateRefusal('git-incomplete', cause.message, ['read the checkout before retrying'])),
      IntakeRefused: (cause) =>
        Effect.fail(new GateRefusal('record-unread', cause.message, ['read the file and its record before retrying'])),
      PlaceUnread: (cause) =>
        Effect.fail(
          new GateRefusal('record-unread', `the checkout cannot be placed: ${cause.reason}`, ['read the checkout before retrying']),
        ),
    }),
  );

export const revertThreadLines = Effect.fn('ChangeRecord.revertThreadLines')(function* (selection: RunSelection) {
  const resolved = yield* checkoutOf(selection);
  if (resolved._tag === 'unavailable')
    return yield* new GateRefusal('root-unproven', resolved.unavailable, ['use a thread with a readable checkout']);
  return yield* readable((yield* ChangeRecord).revertLines(resolved.checkout, selection));
});

export const runFilesOfThread = Effect.fn('ChangeRecord.runFilesOfThread')(function* (
  selection: RunSelection,
  page: { readonly limit: number; readonly after?: string },
) {
  const resolved = yield* checkoutOf(selection);
  if (resolved._tag === 'unavailable')
    return { root: null, files: [], total: 0, next: null, unavailable: resolved.unavailable } satisfies RunFilesRead;
  const read = yield* readable((yield* ChangeRecord).runFiles(resolved.checkout, selection, page));
  const holders = [...new Set(read.files.flatMap((file) => file.held.map((holder) => holder.threadId)))];
  const store = yield* MachineStore;
  const names = yield* (yield* MachineUnits).read((unit) => unit.run(namesOfHolders(store, holders)));
  return {
    ...read,
    root: resolved.checkout.root,
    files: read.files.map((file) => ({
      ...file,
      held: file.held.map((holder) => ({ ...holder, agentName: names.get(holder.threadId)?.name ?? null })),
    })),
  } satisfies RunFilesRead;
});
