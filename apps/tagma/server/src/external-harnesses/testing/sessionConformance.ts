import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { HarnessSessionStore } from '../store/sessions.js';

import type { SessionRows } from '../contract/service/sessionRows.js';

export type SessionFixture = { readonly store: HarnessSessionStore; readonly rows: SessionRows['Service']; readonly id: string };

export function describeSessionStore<R>(
  name: string,
  make: () => Effect.Effect<SessionFixture, unknown, R | Scope.Scope>,
  test: Tester<R | Scope.Scope>,
): void {
  describe(`${name}: session persistence`, () => {
    test('model and switch choices persist on the kernel seat, and clearing a choice leaves the transport in place', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        yield* store.choose(id, { model: 'chosen-model', reasoning: 'high' }, { reasoningDisplay: 'omitted' });
        expect(yield* store.asked(id)).toEqual({ model: 'chosen-model', reasoning: 'high' });
        expect(yield* store.switches(id)).toEqual({ reasoningDisplay: 'omitted' });
        expect((yield* store.road(id)).transport.adapter).toBe('terminal');
        yield* store.choose(id, undefined, {});
        expect(yield* store.asked(id)).toBeUndefined();
        expect((yield* store.binding(id))?.transport.adapter).toBe('terminal');
      }));
    test('an opening reports whether it created or joined the committed session', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        const first = yield* store.opening(id, '', 'first', () => Effect.succeed(null));
        yield* first.announce;
        const joined = yield* store.opening(id, '', 'second', () => Effect.succeed(null));
        yield* joined.announce;
        expect(first.created).toBe(true);
        expect(joined.created).toBe(false);
        expect(joined.session.id).toBe(first.session.id);
      }));
    test('a rolled-back facet never reaches a reader or waiter, and a committed change releases the waiter', () =>
      Effect.gen(function* () {
        const { store, rows, id } = yield* make();
        const waiting = yield* Effect.forkChild(store.wait(id, (facet) => facet.sessionKey === 'committed'));
        yield* Effect.yieldNow;
        const rolledBack = yield* Effect.result(
          rows.within('fixture.rollback', (unit) =>
            Effect.gen(function* () {
              const facet = yield* store.readIn(id, unit);
              if (facet === null) return yield* Effect.die('the fixture session disappeared');
              yield* rows.write(id, { ...facet, sessionKey: 'uncommitted' }, unit);
              yield* unit.afterCommit(Effect.die('a rolled-back tail ran'));
              return yield* new GateRefusal('fixture-rollback', 'The transaction was refused.', ['retry']);
            }),
          ),
        );
        expect(rolledBack._tag).toBe('Failure');
        expect((yield* store.read(id))?.sessionKey).toBeNull();
        yield* store.change(id, (facet) => Effect.succeed({ facet: { ...facet, sessionKey: 'committed' }, value: undefined }));
        expect((yield* Fiber.join(waiting))?.sessionKey).toBe('committed');
      }));
    test('a callback queued before the facet update reads the committed facet', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        let observed: string | null | undefined;
        yield* store.change(id, (facet, unit) =>
          Effect.gen(function* () {
            yield* unit.afterCommit(
              Effect.flatMap(store.read(id), (saved) =>
                Effect.sync(() => {
                  observed = saved?.sessionKey;
                }),
              ).pipe(Effect.orDie),
            );
            return { facet: { ...facet, sessionKey: 'committed' }, value: undefined };
          }),
        );
        expect(observed).toBe('committed');
      }));
    test('an active session without a stored heartbeat stands, and ending it removes its lease', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        yield* store.open(id, '', 'first', () => Effect.succeed(null));
        yield* store.change(id, (facet) =>
          Effect.succeed({
            facet: { ...facet, session: facet.session === undefined ? undefined : { ...facet.session, heartbeatAt: undefined } },
            value: undefined,
          }),
        );
        expect(yield* store.standing('terminal')).toContain(id);
        expect((yield* store.sessionsStanding('terminal')).map((row) => row.threadId)).toContain(id);
        yield* store.change(id, (facet) =>
          Effect.succeed({
            facet: { ...facet, session: facet.session === undefined ? undefined : { ...facet.session, ownerId: null, state: 'ended' } },
            value: undefined,
          }),
        );
        expect(yield* store.standing('terminal')).not.toContain(id);
        expect((yield* store.sessionsStanding('terminal')).map((row) => row.threadId)).not.toContain(id);
      }));
    test('heartbeat serializes with a facet change and refreshes a reused activity read', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        yield* store.open(id, '', 'first', () => Effect.succeed(null));
        const since = store.activeAt(id);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const changing = yield* Effect.forkChild(
          store.change(id, (facet) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return { facet: { ...facet, sessionKey: 'changed' }, value: undefined };
            }),
          ),
        );
        yield* Deferred.await(entered);
        yield* TestClock.adjust(1_000);
        const now = yield* Clock.currentTimeMillis;
        const beating = yield* Effect.forkChild(store.beat('first', 'terminal', [id]));
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(changing);
        expect(yield* Fiber.join(beating)).toContain(id);
        expect({ facet: yield* store.read(id), activeAt: yield* since }).toMatchObject({
          facet: { sessionKey: 'changed', session: { heartbeatAt: new Date(now).toISOString() } },
          activeAt: now,
        });
      }));
    test('a live lease stays with its server, expires on the clock and renews for its new owner', () =>
      Effect.gen(function* () {
        const { store, id } = yield* make();
        const before = yield* Clock.currentTimeMillis;
        const opened = yield* store.open(id, '', 'first', () => Effect.as(TestClock.adjust(1_000), null));
        expect(opened.startedAt).toBe(new Date(before + 1_000).toISOString());
        expect(yield* Effect.flip(store.claim(id, 'second', new Date(before - 1)))).toMatchObject({ code: 'session-owned' });
        yield* TestClock.adjust(60_000);
        expect((yield* store.claim(id, 'second', new Date(before + 59_000))).session?.ownerId).toBe('second');
        expect(yield* Effect.flip(store.claim(id, 'third', new Date(before + 59_000)))).toMatchObject({ code: 'session-owned' });
        yield* TestClock.adjust(60_000);
        expect((yield* store.claim(id, 'third', new Date(before + 119_000))).session?.ownerId).toBe('third');
      }));
  });
}
