import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Fiber } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { ProjectChanges } from '../../../projects/contract/service/changes.js';
import { pinsOver } from '../../../threads/testing/pins.js';
import { ThreadInputRefused } from '../../../threads/contract/service/failure.js';
import type { PinnedView } from '../../../threads/contract/wire/pins.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

const pin = { app: 'poker', view: 'table', key: 'table:1' };
const setup = Effect.gen(function* () {
  const fixture = yield* threadStoreFixture;
  const owners = { store: Context.get(fixture.context, MachineStore), units: fixture.units, records: fixture.records };
  const pins = yield* pinsOver(owners);
  const threadId = yield* fixture.units.write('pins.birth', (unit) =>
    Effect.gen(function* () {
      const row = yield* fixture.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* fixture.threads.rows.attachFacet({ threadId: row.id, projectId: fixture.projectId }, unit);
      return row.id;
    }),
  );
  return { fixture, owners, pins, threadId };
});

it.live('pins form a durable published set, reject foreign projects, and forget removed records in old and restored owners', () =>
  Effect.gen(function* () {
    const { fixture, owners, pins, threadId } = yield* setup;
    const { projectId } = fixture;
    const other = { ...pin, key: 'table:2' };
    const published: (readonly PinnedView[])[] = [];
    const unsubscribe = pins.changed((id) =>
      Effect.flatMap(pins.read(id), (views) =>
        Effect.sync(() => {
          published.push(views);
        }),
      ),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    expect(yield* pins.pin(threadId, projectId, pin)).toBe(true);
    expect(published.at(-1)).toEqual([pin]);
    expect(yield* pins.pin(threadId, projectId, pin)).toBe(false);
    expect(yield* pins.read(threadId)).toEqual([pin]);
    yield* pins.pin(threadId, projectId, other);
    expect(yield* pins.read(threadId)).toEqual([pin, other]);
    yield* pins.unpin(threadId, projectId, pin);
    expect(yield* pins.unpin(threadId, projectId, pin)).toBe(false);
    expect(yield* pins.read(threadId)).toEqual([other]);
    for (const operation of [pins.pin, pins.unpin]) {
      expect(yield* Effect.flip(operation(threadId, projectId + 1000, other))).toMatchObject({ code: 'foreign-project' });
      expect(yield* Effect.flip(operation('missing-thread', projectId, other))).toMatchObject({ code: 'not-found' });
    }
    expect(yield* pins.read(threadId)).toEqual([other]);
    const restored = yield* pinsOver(owners);
    expect(yield* restored.read(threadId)).toEqual([other]);
    yield* fixture.units.write('pins.removeRecord', (unit) => fixture.records.remove(unit, [threadId]));
    expect(yield* restored.read(threadId)).toEqual([]);
    expect(yield* pins.read(threadId)).toEqual([]);
  }),
);

it.live('a pin read at a snapshot stays at its cut after a later pin commit', () =>
  Effect.gen(function* () {
    const { fixture, pins, threadId } = yield* setup;
    const atCut = yield* fixture.units.read(
      (unit) =>
        Effect.gen(function* () {
          yield* fixture.records.facts(threadId, unit);
          yield* pins.pin(threadId, fixture.projectId, pin);
          return yield* pins.read(threadId, unit);
        }),
      { snapshot: true },
    );
    expect(atCut).toEqual([]);
    expect(yield* pins.read(threadId)).toEqual([pin]);
  }),
);

it.live('removing a project retains its thread pins for the current owner and a fresh owner', () =>
  Effect.gen(function* () {
    const { fixture, owners, pins, threadId } = yield* setup;
    yield* pins.pin(threadId, fixture.projectId, pin);
    const projects = Context.get(fixture.context, Projects);
    const changes = Context.get(fixture.context, ProjectChanges);
    const project = yield* projects.byId(fixture.projectId);
    yield* fixture.units.write('pins.removeProject', (unit) =>
      Effect.andThen(projects.remove(unit, project), unit.afterCommit(changes.removed.publish({ projectId: project.id }))),
    );
    expect(yield* pins.read(threadId)).toEqual([pin]);
    expect(yield* (yield* pinsOver(owners)).read(threadId)).toEqual([pin]);
  }),
);

it.live('committed pin publication survives interruption and an idempotent retry repairs a failed publication', () =>
  Effect.gen(function* () {
    const { fixture, pins, threadId } = yield* setup;
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let delivered: readonly PinnedView[] = [];
    const unsubscribe = pins.changed((id) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        delivered = yield* pins.read(id);
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
    const changing = yield* Effect.forkChild(pins.pin(threadId, fixture.projectId, pin));
    yield* Deferred.await(started);
    changing.interruptUnsafe();
    yield* Deferred.succeed(release, undefined);
    expect(Exit.hasInterrupts(yield* Fiber.await(changing))).toBe(true);
    expect(delivered).toEqual([pin]);
    unsubscribe();
    let failed = false;
    const failure = pins.changed((id) => {
      if (!failed) {
        failed = true;
        return Effect.fail(new ThreadInputRefused('publication-failed', 'The observer is unavailable.', ['retry the pin']));
      }
      return Effect.map(pins.read(id), (views) => {
        delivered = views;
      });
    });
    yield* Effect.addFinalizer(() => Effect.sync(failure));
    expect(Exit.isFailure(yield* Effect.exit(pins.unpin(threadId, fixture.projectId, pin)))).toBe(true);
    expect(yield* pins.read(threadId)).toEqual([]);
    yield* pins.unpin(threadId, fixture.projectId, pin);
    expect(delivered).toEqual([]);
  }),
);
