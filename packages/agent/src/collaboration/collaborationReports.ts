import { Effect, Layer } from 'effect';
import type { Cursor } from '@runlith/paging';
import { EndingRunner, EndingStageFailed, EndingStages, type EndingStage, type OwedEnding, type RunEnded } from '../thread/ending';
import type { ThreadStorageFailed } from '../thread/persisted';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnTree } from './ThreadSpawnTree';

const ORDER: readonly EndingStage[] = ['settled', 'reported'];

export const endingRunnerLayer = Layer.effect(
  EndingRunner,
  Effect.gen(function* () {
    const stages = yield* EndingStages;
    const envelopes = yield* ThreadEnvelopes;
    const tree = yield* ThreadSpawnTree;

    const stage = (ended: RunEnded, name: EndingStage): Effect.Effect<void, EndingStageFailed | ThreadStorageFailed> =>
      (name === 'settled' ? tree.settled(ended) : Effect.asVoid(envelopes.completeRun(ended))).pipe(
        Effect.mapError((cause) => new EndingStageFailed({ ending: ended.ending, stage: name, cause })),
        Effect.andThen(stages.acknowledge(ended.ending, name)),
      );

    const running = new Set<string>();

    const run = ({ ending }: { readonly ending: string }): Effect.Effect<void, EndingStageFailed | ThreadStorageFailed> =>
      Effect.suspend(() => {
        if (running.has(ending)) return Effect.void;
        running.add(ending);
        return Effect.gen(function* () {
          const owed = yield* stages.read(ending);
          if (owed === null) return;
          for (const name of ORDER) if (owed.owed.includes(name)) yield* stage(owed.ended, name);
        }).pipe(Effect.ensuring(Effect.sync(() => running.delete(ending))));
      });

    return EndingRunner.of({
      run,
      recover: Effect.fnUntraced(function* ({ limit }) {
        const seen = new Set<string>();
        let settled = 0;
        let cursor: Cursor | null = null;
        do {
          const page: { readonly rows: readonly OwedEnding[]; readonly cursor: Cursor | null } = yield* stages.pending({
            limit,
            cursor: cursor ?? undefined,
          });
          for (const row of page.rows) {
            if (seen.has(row.ending)) continue;
            seen.add(row.ending);
            const ran = yield* Effect.result(run(row));
            if (ran._tag === 'Success') settled += 1;
          }
          cursor = page.cursor;
        } while (cursor !== null);
        return settled;
      }),
    });
  }),
);
