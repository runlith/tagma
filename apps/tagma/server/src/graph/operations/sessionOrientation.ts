import { Effect } from 'effect';
import { admitted, pairsOf, routed } from '../../platform/contract/service/routed.js';
import { Orientation, Touches } from '../contract/service/orientation.js';
import { GraphCall } from '../contract/service/serving.js';
import { ORIENTATION_OPERATIONS as OPS, type TouchPreparation } from '../contract/wire/operations/orientation.js';
import { join, isAbsolute, resolve } from 'node:path';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { GateRefusal, type FieldRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';

type TouchReading = {
  readonly briefs: Effect.Success<ReturnType<Touches['Service']['touch']>>;
  readonly places: readonly TouchPreparation['groups'][number]['place'][];
};
import { atTarget } from './crossing.js';

const SESSION_ORIENTATION_ROUTED = {
  session_start: routed(OPS.session_start, {
    execute: Effect.fnUntraced(function* () {
      const projectId = (yield* yield* GraphCall).project.id;
      const orientation = yield* Orientation;
      return yield* admitted(OPS.session_start)(
        Effect.flatMap(orientation.instructions({ projectId, audience: 'graph' }), (law) => orientation.render({ projectId, law })),
      );
    }),
    answer: (text: string) => ({ status: 'ok' as const, text }),
  }),

  touch_path: routed<
    typeof OPS.touch_path,
    TouchReading,
    TouchPreparation,
    CallerWorkspace | CheckoutPaths | CurrentProject | Touches,
    StoreFailure | GateRefusal<(typeof OPS.touch_path)['refusals'][number] | FieldRefusal>
  >(OPS.touch_path, {
    prepare: Effect.fn('touch_path.prepare')(function* (input: (typeof OPS.touch_path)['input']['Type']) {
      const workspace = yield* CallerWorkspace;
      const paths = yield* CheckoutPaths;
      const explicit = input.project !== undefined || (yield* CallerAim)?.project !== undefined;
      const projectId = explicit ? (yield* yield* CurrentProject).project.id : null;
      const groups = new Map<
        string,
        { place: TouchPreparation['groups'][number]['place']; shown: TouchPreparation['groups'][number]['shown'][number][] }
      >();
      for (const one of input.shown) {
        if (!isAbsolute(one.path) && workspace === null)
          return yield* new GateRefusal('project-required', 'A relative touch needs a checkout.', ['name an absolute path']);
        const path = resolve(workspace?.root ?? '.', one.path);
        const placed = yield* paths
          .resourceAcross(path)
          .pipe(Effect.mapError((failure) => new GateRefusal('files', failure.reason, ['read the checkout again'])));
        if (placed === null) continue;
        if (projectId !== null && placed.projectId !== projectId)
          return yield* new GateRefusal(
            'place-mismatch',
            `This touch names project ${projectId}, but ${path} belongs to project ${placed.projectId}.`,
            ['split the paths by their projects'],
          );
        const key = `${placed.projectId}\u0000${placed.root}`;
        const group = groups.get(key) ?? { place: { projectId: placed.projectId, checkout: placed.root, branch: null }, shown: [] };
        group.shown.push({ ...one, path: placed.path });
        groups.set(key, group);
      }
      return { groups: [...groups.values()] } satisfies TouchPreparation;
    }),
    execute: Effect.fnUntraced(function* (_input, prepared: TouchPreparation) {
      const pool = yield* RoutedGraphs;
      const results = yield* Effect.forEach(prepared.groups, (group) =>
        Effect.gen(function* () {
          if (pool === null)
            return yield* new GateRefusal('graph-pool', 'This touch needs the served graph pool.', ['call a running server']);
          const served = yield* pool
            .resolve({ projectId: group.place.projectId, cwd: group.place.checkout ?? undefined })
            .pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', `${failure.code}: ${failure.reason}`, failure.unblock)));
          yield* served
            .fresh()
            .pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', `${failure.code}: ${failure.reason}`, failure.unblock)));
          const briefs = yield* atTarget(
            { projectId: group.place.projectId, graph: served.context },
            admitted(OPS.touch_path)(
              Effect.flatMap(Touches, (touches) => touches.touch({ projectId: group.place.projectId, shown: group.shown })),
            ),
          );
          return {
            place: { ...group.place, checkout: served.checkout },
            briefs: briefs.map((brief) => ({ ...brief, place: join(served.checkout, brief.place) })),
          };
        }),
      );
      return { briefs: results.flatMap((result) => result.briefs), places: results.map((result) => result.place) };
    }),
    answer: (reading: TouchReading) => ({ status: 'ok' as const, ...reading }),
  }),
};

export const SESSION_ORIENTATION_PAIRS = pairsOf(SESSION_ORIENTATION_ROUTED);
