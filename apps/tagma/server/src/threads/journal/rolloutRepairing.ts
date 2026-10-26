import { Context, Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { RolloutRepair, ThreadRolloutDisagreement } from '../contract/wire/evidence.js';
import { gated } from '../projectGate.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { rolloutTransformed } from './rolloutGeneration.js';
import { openRollout } from './rolloutForms.js';
import type { RolloutContext } from './rolloutContext.js';
import { unformableRefusal, type RolloutForms } from './rolloutForming.js';
import type { ThreadRolloutReport } from './report.js';
import type { ThreadRolloutRepair } from './repair.js';

export const rolloutRepairing = (
  ctx: RolloutContext,
  forms: RolloutForms,
  repair: ThreadRolloutRepair,
  rollout: ThreadRolloutReport,
  rehydrate: (threadId: string) => Effect.Effect<void, HarnessFailure>,
) => {
  const { records, floor, projection, graph, inJournal, pathOf } = ctx;

  const repaired = (threadId: string, projectId: number): Effect.Effect<RolloutRepair, HarnessFailure> =>
    gated(records, threadId, projectId, () =>
      Effect.gen(function* () {
        const path = pathOf(projectId, threadId);
        if (path === undefined) {
          return yield* new GateRefusal('no-rollout-home', `This deployment keeps no rollout for ${threadId}.`, [
            'a repair acts on a file, and this server writes none',
          ]);
        }
        const opened = forms.reformedHere(threadId, path).pipe(
          Effect.andThen(openRollout(path, rolloutTransformed(Context.get(graph, MachineStore), threadId, path))),
          Effect.catchTag('RolloutUnreadable', (failure) =>
            Effect.fail(
              new GateRefusal(`rollout-${failure.reason}`, failure.message, [
                'the compressed rollout could not be opened; the file stands exactly as it did',
              ]),
            ),
          ),
          Effect.catchTag('RolloutUnformable', (failure) => Effect.fail(unformableRefusal(failure))),
        );
        const done = yield* inJournal(
          threadId,
          opened.pipe(
            Effect.tap(() => Effect.sync(() => floor.forget(threadId))),
            Effect.andThen(repair.repair({ threadId, path })),
            Effect.tap(() => Effect.sync(() => floor.forget(threadId))),
          ),
        ).pipe(
          Effect.catchTag('ThreadProjectionRefused', (failure) =>
            Effect.fail(
              new GateRefusal(`rollout-${failure.reason}`, failure.message, [
                'read what this rollout disagrees about first; the file is exactly as it stood',
                'this act renumbers records, it does not invent bytes: a line nobody can read is restored, never repaired here',
              ]),
            ),
          ),
        );
        yield* rehydrate(threadId);
        const carried = yield* inJournal(
          threadId,
          projection.run({ threadId, path }).pipe(
            Effect.map(({ projected }): number | null => projected),
            Effect.catch((failure) => Effect.as(projection.record(failure), null)),
          ),
        );
        return { repair: done, projected: carried };
      }),
    );

  const reported = (threadId: string, projectId: number, limit?: number): Effect.Effect<ThreadRolloutDisagreement, HarnessFailure> =>
    gated(records, threadId, projectId, () =>
      rollout.read({
        threadId,
        path: pathOf(projectId, threadId),
        records: limit,
      }),
    );

  return { repair: repaired, report: reported };
};
