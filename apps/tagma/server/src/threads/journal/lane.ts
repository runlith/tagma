import { Cause, Context, Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { ThreadResourceStorage } from '@runlith/agent/thread/storage/resources';
import type { Lane } from '@runlith/held/Lane';
import { Settings } from '../../settings/contract/service/values.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { sourcesOutside, unfiledHeirs } from './base.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { Background } from '../../platform/contract/service/background.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { RolloutRepair, ThreadRolloutDisagreement } from '../contract/wire/evidence.js';
import type { ThreadGate } from '../list/store.js';
import type { ThreadEvictionVerdict, ThreadSweep } from '../contract/wire/eviction.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { ThreadRunning, ThreadShelving } from '../contract/service/reads.js';
import { ScratchAreas } from '../contract/service/scratch.js';
import { ThreadResources } from '../store/resources.js';
import { NativeRolloutPart, ExternalRolloutPart } from '../contract/service/parts.js';
import { threadRolloutMeta, type RolloutParts } from './rolloutMeta.js';
import { releaseRollout } from './rolloutForms.js';
import type { ThreadProjection } from './projection.js';
import type { ThreadRolloutReport } from './report.js';
import type { ThreadRolloutRepair } from './repair.js';
import { RolloutWriting } from './rolloutWriter.js';
import { rolloutContext } from './rolloutContext.js';
import { rolloutEvicting } from './rolloutEviction.js';
import { rolloutExporting } from './rolloutExporting.js';
import { rolloutReconciling } from './rolloutReconciling.js';
import type { RolloutForms } from './rolloutForming.js';
import { rolloutRehydrating } from './rolloutRehydrate.js';
import { rolloutRepairing } from './rolloutRepairing.js';
import { rolloutWhole } from './rolloutWhole.js';
import { rolloutShelf } from './rolloutShelf.js';
import { threadUses } from './uses.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';

export class JournalOrder extends Context.Service<JournalOrder, Lane>()('tagma/threads/JournalOrder') {}

export const makeThreadRollouts = Effect.fnUntraced(function* ({
  projection,
  rollout,
  repair,
  runAppend,
  forms,
  background,
  home: rolloutHome,
}: {
  readonly projection: ThreadProjection;
  readonly rollout: ThreadRolloutReport;
  readonly repair: ThreadRolloutRepair;
  readonly runAppend: (effect: Effect.Effect<void>) => void;
  readonly forms: RolloutForms;
  readonly background: Background['Service'];
  readonly home?: string;
}) {
  const threads = { ...(yield* ThreadRunning), ...(yield* ThreadShelving) };
  const records = yield* ThreadRecords;
  const units = yield* MachineUnits;
  const floor = yield* RolloutWriting;
  const resources = yield* ThreadResources;
  const ledger = resources.storage;
  const resourceKinds = () => resources.kinds;
  const scratch = yield* ScratchAreas;
  const graph = yield* Effect.context<GraphServices | MachineStore>();
  const settings = yield* Settings;
  const parts: RolloutParts = { native: yield* NativeRolloutPart, external: yield* ExternalRolloutPart };
  const journal = yield* JournalOrder;
  const kinds = yield* ThreadEntryKinds;
  const ctx = rolloutContext({ records, floor, projection, graph, parts, kinds, journal, home: rolloutHome });
  const { rehydrate, wake } = rolloutRehydrating(ctx, forms, scratch);
  const uses = threadUses((threadId) => shelve([threadId]));
  const exporting = rolloutExporting(ctx);
  const { ensure, behind, owed, exportStanding, written, rewrite } = exporting;
  const { evict, rest, sweep } = rolloutEvicting(ctx, threads, ledger, resourceKinds, settings, uses, rewrite, exporting.whole);
  const { repair: repaired, report } = rolloutRepairing(ctx, forms, repair, rollout, rehydrate);
  const whole = rolloutWhole(ctx, forms, rest, wake, runAppend, uses, background);
  const { shelve, shelving } = rolloutShelf(ctx, evict);
  const appendMeta = (threadId: string): Effect.Effect<void> => {
    if (rolloutHome === undefined) return Effect.void;
    return ctx
      .inJournal(
        threadId,
        Effect.gen(function* () {
          const meta = yield* units.markReadOnly(ctx.machineStore(threadRolloutMeta(threadId, parts)));
          if (meta === null || meta.record.projectId == null) return;
          const journal = yield* ctx.journalOf(threadId);
          if (journal === undefined) return;
          yield* floor.appendRecord(threadId, journal, { kind: 'meta', meta });
        }),
      )
      .pipe(
        Effect.catchCause((cause) => Effect.sync(() => console.error(`[tagma] rollout meta failed for ${threadId}`, Cause.squash(cause)))),
      );
  };

  return ThreadRollouts.of({
    pathOf: ctx.pathOf,
    locate: ctx.locate,
    rehydrate: (threadId, read) => Effect.tap(rehydrate(threadId, read), () => whole.resident(threadId)),
    formRested: whole.rested,
    formLagging: whole.lagging,
    evict,
    sweep,
    shelve,
    shelving,
    using: uses.using,
    ensure,
    behind,
    owed,
    exportStanding,
    replay: rolloutReconciling(ctx, forms, written),
    repair: repaired,
    report,

    appendRecord: (threadId, record) => {
      if (rolloutHome === undefined) return;
      runAppend(
        Effect.gen(function* () {
          const journal = yield* ctx.journalOf(threadId);
          if (journal === undefined) return;
          yield* ctx.inJournal(threadId, floor.appendRecord(threadId, journal, record));
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => console.error(`[tagma] rollout record failed for ${threadId}`, Cause.squash(cause))),
          ),
        ),
      );
    },

    appendMeta,

    queueMeta: (threadId) => {
      if (rolloutHome !== undefined) runAppend(appendMeta(threadId));
    },

    freeing: Effect.fnUntraced(function* (threadIds) {
      const { db } = Context.get(graph, MachineStore);
      const sources = yield* units.read((unit) => sourcesOutside(db, unit, threadIds));
      return Effect.andThen(
        Effect.flatMap(
          units.read((unit) => unfiledHeirs(db, unit, threadIds)),
          (heirs) => Effect.forEach(heirs, rewrite, { discard: true }),
        ),
        Effect.forEach(
          sources,
          Effect.fnUntraced(function* (sourceId) {
            const projectId = yield* records.projectOf(sourceId);
            if (projectId !== undefined) yield* evict(projectId, sourceId);
          }),
          { discard: true },
        ),
      );
    }),

    release: Effect.fnUntraced(function* (projectId, threadId) {
      const path = ctx.pathOf(projectId, threadId);
      if (path !== undefined) yield* releaseRollout(path);
      floor.forget(threadId);
      yield* floor.unmark(threadId);
    }),
  });
});
