import { and, asc, eq, isNotNull, lt, or } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ServedGraphs } from '../graph/contract/service/serving.js';
import { Orientation } from '../graph/contract/service/orientation.js';
import { instructionChanges } from '../graph/orientation/Instructions.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { Projects } from '../projects/contract/service/registry.js';
import type { GraphOrigin } from './contract/wire/target.js';
import { WorkPlaces } from './contract/service/working.js';
import { threadCopy, threadPlace } from './store/places.js';

const entering = writes('WorkingPlaces.enter', [threadPlace]);
const marking = writes('WorkingPlaces.mark', [threadCopy]);
const handing = writes('WorkingPlaces.handed', [threadCopy]);
const leaving = writes('WorkingPlaces.leave', [threadPlace]);

const copyKey = (place: GraphOrigin): string => `${place.projectId}\u0000${place.root}`;

const lawUnread = (place: GraphOrigin, deferred: boolean): GateRefusal<'instructions-unread'> =>
  new GateRefusal(
    'instructions-unread',
    deferred
      ? `The law of project ${place.projectId} (${place.root}) has not reached the thread; the act was not run.`
      : `This is the thread's first change in project ${place.projectId} (${place.root}), and its law reaches the thread with this answer; the act was not run.`,
    [
      deferred
        ? 'read the project instructions delivered on the next model step, then call the act again'
        : 'read the orientation of that project delivered beside this answer, then call the act again',
    ],
  );

export const makeWorkingPlaces = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const paths = yield* CheckoutPaths;
  const graphs = yield* ServedGraphs;
  const projects = yield* Projects;
  const locate: WorkPlaces['Service']['locate'] = (path) =>
    Effect.map(paths.placeAcross(path), (place) => (place === null ? null : { projectId: place.projectId, root: place.root }));
  const marked = new Map<string, Map<string, number>>();
  const taken = new Map<string, number>();
  const standing = Effect.fn('WorkPlaces.standing')(function* (threadId: string, pending: boolean) {
    const entered = yield* units.read((unit) =>
      unit.run(
        db
          .select({ projectId: threadCopy.projectId, root: threadCopy.root })
          .from(threadCopy)
          .where(and(eq(threadCopy.threadId, threadId), pending ? isNotNull(threadCopy.pendingAt) : undefined))
          .orderBy(asc(threadCopy.enteredAt), asc(threadCopy.projectId), asc(threadCopy.root)),
      ),
    );
    if (entered.length === 0) return entered;
    const removed = new Set(yield* projects.removed());
    const copies: GraphOrigin[] = [];
    const seen = new Set<string>();
    for (const place of entered) {
      if (removed.has(place.projectId)) continue;
      const located = yield* locate(place.root);
      if (located?.projectId !== place.projectId) continue;
      const key = copyKey(located);
      if (seen.has(key)) continue;
      seen.add(key);
      copies.push(located);
    }
    return copies as readonly GraphOrigin[];
  });
  const mark = Effect.fn('WorkPlaces.mark')(function* (threadId: string, place: GraphOrigin) {
    const key = copyKey(place);
    const cached = marked.get(threadId)?.get(key);
    if (cached !== undefined && cached >= (taken.get(threadId) ?? Number.NEGATIVE_INFINITY)) return;
    const now = yield* Clock.currentTimeMillis;
    yield* units.write(marking, (unit) =>
      unit.run(
        db
          .insert(threadCopy)
          .values({ threadId, projectId: place.projectId, root: place.root, pendingAt: new Date(now) })
          .onConflictDoUpdate({ target: [threadCopy.threadId, threadCopy.projectId, threadCopy.root], set: { pendingAt: new Date(now) } }),
      ),
    );
    marked.set(threadId, (marked.get(threadId) ?? new Map<string, number>()).set(key, now));
  });
  const rooted = (place: GraphOrigin) =>
    locate(place.root).pipe(
      Effect.match({
        onSuccess: (located) => (located?.projectId === place.projectId ? located.root : place.root),
        onFailure: () => place.root,
      }),
    );
  return WorkPlaces.of({
    held: Effect.fn('WorkPlaces.held')(function* (threadId) {
      const places = yield* units.read((unit) =>
        unit.run(
          db
            .select({ projectId: threadPlace.projectId, root: threadPlace.root })
            .from(threadPlace)
            .where(eq(threadPlace.threadId, threadId))
            .orderBy(asc(threadPlace.enteredAt), asc(threadPlace.projectId)),
        ),
      );
      if (places.length === 0) return places;
      const removed = new Set(yield* projects.removed());
      return places.filter((place) => !removed.has(place.projectId));
    }),
    worked: (threadId) => standing(threadId, false),
    taking: Effect.fn('WorkPlaces.taking')(function* (threadId) {
      const through = yield* Clock.currentTimeMillis;
      taken.set(threadId, through);
      return { copies: yield* standing(threadId, true), through: new Date(through) };
    }),
    handed: Effect.fn('WorkPlaces.handed')(function* (threadId, pending) {
      if (pending.copies.length === 0) return;
      yield* units.write(handing, (unit) =>
        unit.run(
          db
            .update(threadCopy)
            .set({ pendingAt: null })
            .where(
              and(
                eq(threadCopy.threadId, threadId),
                lt(threadCopy.pendingAt, pending.through),
                or(...pending.copies.map((copy) => and(eq(threadCopy.projectId, copy.projectId), eq(threadCopy.root, copy.root)))),
              ),
            ),
        ),
      );
    }),
    locate,
    resource: paths.resourceAcross,
    checkoutOf: paths.placeAcross,
    within: (directory) =>
      Effect.map(paths.rootsWithin(directory), (roots) => roots.map((root) => ({ projectId: root.projectId, root: root.root }))),
    graphAt: (place) =>
      Effect.flatMap(graphs.resolve({ projectId: place.projectId, cwd: place.root }), (served) => Effect.as(served.fresh(), served)),
    enter: Effect.fn('WorkPlaces.enter')(function* (input) {
      const { threadId, place } = input;
      if (place.projectId === input.home) {
        if (input.mutates) yield* mark(threadId, place);
        return;
      }
      const root = yield* rooted(place);
      if (input.mutates) yield* mark(threadId, { projectId: place.projectId, root });
      const standing = yield* units.read((unit) =>
        unit.run(
          db
            .select({ root: threadPlace.root })
            .from(threadPlace)
            .where(and(eq(threadPlace.threadId, threadId), eq(threadPlace.projectId, place.projectId)))
            .get(),
        ),
      );
      if (standing?.root !== root)
        yield* units.write(entering, (unit) =>
          unit.run(
            db
              .insert(threadPlace)
              .values({ threadId, projectId: place.projectId, root })
              .onConflictDoUpdate({ target: [threadPlace.threadId, threadPlace.projectId], set: { root } }),
          ),
        );
      if (!input.mutates) return;
      const law = input.law;
      if (law === undefined) {
        if (standing === undefined) return yield* lawUnread({ projectId: place.projectId, root }, false);
        return;
      }
      if (law === null || law.projectId !== place.projectId) return yield* lawUnread({ projectId: place.projectId, root }, true);
      const served = yield* graphs.resolve({ projectId: place.projectId, cwd: root });
      yield* served.fresh();
      const current = yield* Effect.provide(
        Effect.flatMap(Orientation, (orientation) => orientation.instructions({ projectId: place.projectId, audience: law.audience })),
        served.context,
      ).pipe(Effect.mapError((failure) => new GateRefusal('graph-pool', failure.message, ['read the project checkout again'])));
      const changes = instructionChanges(current, law);
      if (changes.pending.length !== 0 || changes.withdrawn.length !== 0)
        return yield* lawUnread({ projectId: place.projectId, root }, true);
    }),
    acted: Effect.fn('WorkPlaces.acted')(function* ({ threadId, home, place }) {
      yield* mark(threadId, place.projectId === home ? place : { projectId: place.projectId, root: yield* rooted(place) });
    }),
    leave: (threadId, projectId) =>
      Effect.asVoid(
        units.write(leaving, (unit) =>
          unit.run(db.delete(threadPlace).where(and(eq(threadPlace.threadId, threadId), eq(threadPlace.projectId, projectId)))),
        ),
      ),
  });
});
