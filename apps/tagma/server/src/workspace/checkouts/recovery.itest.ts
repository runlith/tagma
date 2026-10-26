import { expect } from 'bun:test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import type { CheckoutState } from '../contract/wire/checkout.js';
import { RootUnavailable } from '../contract/wire/roots.js';
import { fixture, namespaceId, pause, rowTests, WATCH_BUDGET } from '../testing/rowsFixture.js';

rowTests('checkout reading recovery', (it) => {
  it.effect('an explicit refresh reads before watch delivery, completes when unchanged and refuses a failed reading', () =>
    Effect.gen(function* () {
      const { rowsOver, files, paths, root, rootId, door } = yield* fixture;
      const status = yield* rowsOver({
        follow: () => Effect.succeed({ shifts: Stream.never, watching: () => true, release: () => undefined }),
      });
      yield* Stream.runHead(yield* status.follow(rootId));
      const earlier = yield* pause;
      door.hold(earlier);
      yield* status.mark(rootId);
      yield* Deferred.await(earlier.arrived);
      yield* files.writeFileString(paths.join(root, 'later.txt'), 'held before watch delivery\n');
      const marked = yield* Deferred.make<void>();
      const detach = status.onMark(() => Effect.asVoid(Deferred.succeed(marked, undefined)));
      const refreshing = yield* Effect.forkChild(status.refresh(rootId));
      yield* Deferred.await(marked);
      detach();
      yield* Deferred.succeed(earlier.gate, undefined);
      const fresh = yield* Fiber.join(refreshing);
      expect(fresh.entries.untracked.entries.map((entry) => entry.path)).toContain('later.txt');
      expect(fresh.stale).toBe(false);
      expect(yield* status.refresh(rootId)).toMatchObject({ head: fresh.head, entries: fresh.entries, stale: false });
      door.refuseListing();
      expect((yield* Effect.flip(status.refresh(rootId)))._tag).toBe('GitRefused');
    }),
  );
  it.effect('a reading whose cycle broke marks its row stale and the next mark reads it again', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const rows: CheckoutState[] = [];
      const arrived = yield* Deferred.make<void>();
      const stale = yield* Deferred.make<void>();
      const fresh = yield* Deferred.make<void>();
      yield* Effect.forkChild(
        Stream.runForEach(status.subscribe(rootId), (row) =>
          Effect.gen(function* () {
            rows.push(row);
            yield* Deferred.succeed(arrived, undefined);
            if (row.stale) yield* Deferred.succeed(stale, undefined);
            else if (rows.some((seen) => seen.stale)) yield* Deferred.succeed(fresh, undefined);
          }),
        ),
      );
      yield* Deferred.await(arrived);
      const error = console.error;
      console.error = () => undefined;
      door.breakListing(true);
      yield* status.mark(rootId);
      yield* Deferred.await(stale).pipe(Effect.ensuring(Effect.sync(() => (console.error = error))));
      door.breakListing(false);
      yield* status.mark(rootId);
      yield* Effect.timeoutOrElse(Deferred.await(fresh), {
        duration: WATCH_BUDGET,
        orElse: () => Effect.die(`no fresh row followed the broken cycle within ${WATCH_BUDGET}`),
      });
      expect(rows.at(-1)?.stale).toBe(false);
    }),
  );
  it.effect('a reading that failed is read again for the reader that comes back', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      door.refuseListing();
      const [failed] = yield* Stream.runCollect(Stream.take(status.subscribe(rootId), 1));
      door.admitListing();
      const [again] = yield* Stream.runCollect(Stream.take(status.subscribe(rootId), 1));
      const refused = yield* Deferred.make<void>();
      yield* Effect.forkChild(
        Stream.runForEach(status.subscribe(rootId), (row) => (row.stale ? Deferred.succeed(refused, undefined) : Effect.void)),
      );
      door.refuseListing();
      yield* status.mark(rootId);
      yield* Deferred.await(refused);
      door.admitListing();
      const [based] = yield* Stream.runCollect(Stream.take(status.subscribe(rootId, 'base'), 1));
      expect(failed?.stale).toBe(true);
      expect(again?.stale).toBe(false);
      expect(based?.stale).toBe(false);
    }),
  );
  it.effect('a follow whose watch cannot open leaves its root readable', () =>
    Effect.gen(function* () {
      const { rowsOver, rootId } = yield* fixture;
      const status = yield* rowsOver({
        follow: (asked) => new RootUnavailable({ namespaceId, rootId: asked, reason: 'filesystem', message: 'no descriptor left' }),
      });
      const followed = yield* Effect.exit(Stream.runHead(status.subscribe(rootId)));
      const row = yield* Effect.timeoutOrElse(status.read(rootId), {
        duration: WATCH_BUDGET,
        orElse: () => Effect.die(`the root answered no reading within ${WATCH_BUDGET} after its watch failed`),
      });
      expect(followed._tag).toBe('Failure');
      expect(row.stale).toBe(false);
      expect(row.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt']);
    }),
  );
});
