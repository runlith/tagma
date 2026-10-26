import { expect, spyOn } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Effect, Exit, Fiber, FileSystem, Scope, Stream } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { ArtifactStore } from './contract/service/shelf.js';
import { TIMELINE_DECLARATION } from './contract/wire/fragment.js';
import { versionedShelf } from './shelf.js';
import { VersionedShelf } from './storage.js';

const workspace = Effect.fnUntraced(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'artifacts-' });
  let now = 0;
  return {
    root: join(root, 'artifacts'),
    storage: new VersionedShelf(join(root, 'artifacts'), 'http://localhost:5634'),
    now: () => now++,
    store: yield* versionedShelf(join(root, 'artifacts'), 'http://localhost:5634'),
    page: Effect.fnUntraced(function* (name: string, html: string) {
      const path = join(root, name);
      yield* fileSystem.writeFileString(path, html);
      return path;
    }),
  };
});

const publish = (store: ArtifactStore['Service'], input: { path: string; title?: string; thread?: string }) =>
  Effect.map(store.publish({ thread: 'lead', ...input }), (published) => published.record);

layer(BunFileSystem.layer, { excludeTestServices: true })('artifact shelf', (it) => {
  it.effect('publication keeps path identity and old versions, names pages and refuses missing or empty content', () =>
    Effect.gen(function* () {
      const { storage: store, page, now } = yield* workspace();
      expect(store.list({ limit: 1 })).toEqual({ rows: [], total: 0, more: false });
      expect(store.page('deadbeef1234')).toBeNull();
      expect(store.versions('deadbeef1234')).toEqual([]);
      const path = yield* page('report.html', '<title>Burn rate</title><body>first cut');
      const first = store.publish({ path, thread: 'lead' }, now).record;
      expect(first.title).toBe('Burn rate');
      yield* page('report.html', '<title>Burn rate</title><body>second cut');
      const second = store.publish({ path, title: 'Told', thread: 'lead' }, now).record;
      expect(second.url).toBe(first.url);
      expect(second.version).not.toBe(first.version);
      expect(second.title).toBe('Told');
      expect(store.versions(first.id)).toHaveLength(2);
      expect(store.page(first.id)?.html).toContain('second cut');
      expect(store.page(first.id, first.version)?.html).toContain('first cut');
      const bare = store.publish({ path: yield* page('bare.html', '<p>no head at all'), thread: 'lead' }, now).record;
      expect(bare.title).toBe('Untitled');
      expect(bare.id).not.toBe(first.id);
      expect(store.list({ limit: 2 })).toMatchObject({ total: 2, more: false });
      expect(() => store.publish({ path: join(path, '..', 'missing.html'), thread: 'lead' }, now)).toThrow(GateRefusal);
      const empty = yield* page('blank.html', '   ');
      expect(() => store.publish({ path: empty, thread: 'lead' }, now)).toThrow(GateRefusal);
    }),
  );

  it.effect('a team reads the pages its threads published, once each, the first thread asked owning a shared page', () =>
    Effect.gen(function* () {
      const { storage: store, page, now } = yield* workspace();
      const report = yield* page('report.html', '<title>Report</title>');
      store.publish({ path: report, thread: 'helper' }, now);
      const own = store.publish({ path: yield* page('own.html', '<title>Own</title>'), thread: 'lead' }, now).record;
      const shared = store.publish({ path: report, thread: 'lead' }, now).record;
      store.publish({ path: yield* page('else.html', '<title>Elsewhere</title>'), thread: 'stranger' }, now);
      const team = store.pages(['lead', 'helper'], 1);
      expect(team).toEqual({ pages: [{ thread: 'lead', artifact: shared }], total: 2 });
      expect(store.pages(['lead', 'helper'], 2).pages.map((row) => [row.artifact.id, row.thread])).toEqual([
        [shared.id, 'lead'],
        [own.id, 'lead'],
      ]);
      expect(team.pages[0]?.artifact.versions).toBe(2);
      expect(store.pages(['helper'], 1).pages.map((row) => row.artifact.id)).toEqual([shared.id]);
      expect(store.pages(['nobody'], 1)).toEqual({ pages: [], total: 0 });
    }),
  );

  it.effect('a cursor keeps its snapshot across publication and refuses after rebuilding a damaged index', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { storage: store, root, page, now } = yield* workspace();
      const oldest = store.publish({ path: yield* page('oldest.html', '<title>Oldest</title>'), thread: 'lead' }, now).record;
      const newer = store.publish({ path: yield* page('newer.html', '<title>Newer</title>'), thread: 'lead' }, now).record;
      const first = store.list({ limit: 1 });
      const key = first.rows[0]!.key;
      expect(first.rows.map((row) => row.record.id)).toEqual([newer.id]);
      store.publish({ path: oldest.sourcePath, title: 'Republished', thread: 'lead' }, now);
      const rest = store.list({ limit: 1, after: key });
      expect(rest.rows.map((row) => row.record.title)).toEqual(['Oldest']);
      expect(rest).toMatchObject({ total: 2, more: false });
      yield* fs.writeFileString(join(root, `order.${key.epoch}.log`), 'broken\n');
      expect(() => store.list({ limit: 1, after: key })).toThrow('cursor-stale');
      const reopened = new VersionedShelf(root, 'http://localhost:5634');
      const rebuilt = reopened.list({ limit: 2 });
      expect(rebuilt.rows.map((row) => row.record.title)).toEqual(['Republished', 'Newer']);
      expect(rebuilt.total).toBe(2);
      expect(reopened.pages(['lead'], 1).pages[0]?.artifact.title).toBe('Republished');
    }),
  );

  it.effect('republishing compacts the order log and keeps current and retained pages readable', () =>
    Effect.gen(function* () {
      const { storage: store, root, page, now } = yield* workspace();
      const path = yield* page('history.html', '<title>History</title>');
      const first = store.publish({ path, thread: 'lead' }, now).record;
      const key = store.list({ limit: 1 }).rows[0]!.key;
      let latest = first;
      for (let publication = 0; publication < 64; publication += 1) latest = store.publish({ path, thread: 'lead' }, now).record;
      expect(store.maintain()).toBeNull();
      expect(() => store.list({ limit: 1, after: key })).toThrow('cursor-stale');
      expect(store.list({ limit: 1 }).rows[0]?.record.version).toBe(latest.version);
      const kept = store.versions(first.id);
      expect(kept).toHaveLength(20);
      expect(store.page(first.id, first.version)).toBeNull();
      expect(store.page(first.id, kept[1])?.record.version).toBe(kept[1]);
      const reopened = new VersionedShelf(root, 'http://localhost:5634');
      expect(reopened.list({ limit: 1 }).rows[0]?.record.version).toBe(latest.version);
    }),
  );

  it.effect('a lost worker fails its pending read and the next read restores the published page', () =>
    Effect.gen(function* () {
      const { store, page } = yield* workspace();
      const ActualWorker = globalThis.Worker;
      let worker: Worker | undefined;
      const restore = yield* Effect.acquireRelease(
        Effect.sync(() => {
          globalThis.Worker = class extends ActualWorker {
            constructor(...input: ConstructorParameters<typeof ActualWorker>) {
              super(...input);
              worker = this;
            }
          };
          return () => {
            globalThis.Worker = ActualWorker;
          };
        }),
        (restore) => Effect.sync(restore),
      );
      const published = yield* publish(store, { path: yield* page('worker.html', '<title>Restored</title>') });
      const following = yield* Stream.toPull(store.follow(['lead'], 1));
      expect((yield* following)[0]?.pages[0]?.artifact.version).toBe(published.version);
      const running = worker!;
      yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(running, 'postMessage').mockImplementation(() => running.terminate())),
        (mock) => Effect.sync(() => mock.mockRestore()),
      );
      expect(Exit.isFailure(yield* Effect.exit(store.page(published.id)))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(following))).toBe(true);
      restore();
      expect((yield* store.page(published.id))?.html).toBe('<title>Restored</title>');
      expect((yield* store.follow(['lead'], 1).pipe(Stream.take(1), Stream.runCollect))[0]?.pages[0]?.artifact.version).toBe(
        published.version,
      );
    }),
  );

  it.effect('followers share their active selection, update only the published page and release it after the last reader', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { store, root, page } = yield* workspace();
      const held = yield* publish(store, { path: yield* page('held.html', '<title>Held</title>') });
      const shared = yield* publish(store, { path: yield* page('shared.html', '<title>Shared</title>'), thread: 'helper' });
      const lifetime = yield* Effect.scope;
      const firstScope = yield* Scope.fork(lifetime);
      const first = yield* Stream.toPull(store.follow(['lead', 'helper'], 2)).pipe(Effect.provideService(Scope.Scope, firstScope));
      const initial = yield* first;
      expect(initial[0]?.total).toBe(2);
      const parked = join(root, '..', 'parked');
      yield* fs.rename(join(root, held.id), parked);
      const secondScope = yield* Scope.fork(lifetime);
      const second = yield* Stream.toPull(store.follow(['lead', 'helper'], 2)).pipe(Effect.provideService(Scope.Scope, secondScope));
      expect(yield* second).toEqual(initial);
      yield* Scope.close(firstScope, Exit.void);

      const claimed = yield* publish(store, { path: shared.sourcePath });
      expect(yield* second).toEqual([
        {
          pages: [
            { thread: 'lead', artifact: claimed },
            { thread: 'lead', artifact: held },
          ],
          total: 2,
        },
      ]);
      const newest = yield* publish(store, { path: yield* page('new.html', '<title>New</title>') });
      yield* Effect.sleep(2);
      const outside = yield* publish(store, { path: shared.sourcePath, thread: 'stranger', title: 'Republished outside the team' });
      expect(yield* second).toEqual([
        {
          pages: [
            { thread: 'lead', artifact: outside },
            { thread: 'lead', artifact: newest },
          ],
          total: 3,
        },
      ]);
      yield* Scope.close(secondScope, Exit.void);

      const reopened = yield* store.follow(['lead', 'helper'], 2).pipe(Stream.take(1), Stream.runCollect);
      expect(reopened).toEqual([
        {
          pages: [
            { thread: 'lead', artifact: outside },
            { thread: 'lead', artifact: newest },
          ],
          total: 2,
        },
      ]);
      yield* fs.rename(parked, join(root, held.id));
      expect((yield* store.follow(['lead', 'helper'], 1).pipe(Stream.take(1), Stream.runCollect))[0]).toEqual({
        pages: [{ thread: 'lead', artifact: outside }],
        total: 3,
      });
    }),
  );

  it.effect('a page follower reads its current version, kept versions and declared timeline, and moves with each republish', () =>
    Effect.gen(function* () {
      const { store, page } = yield* workspace();
      const path = yield* page('intro.html', `<title>Intro</title>${TIMELINE_DECLARATION}`);
      const first = yield* publish(store, { path });
      expect(first.timeline).toEqual({ v: 1, duration: 6, fps: 30, width: 1920, height: 1080 });
      const next = yield* Stream.toPull(store.followPage(first.id));
      expect(yield* next).toEqual([{ current: first, kept: [first.version] }]);
      yield* page('intro.html', '<title>Intro</title><p>a document now');
      const second = yield* publish(store, { path });
      expect(second.timeline).toBeNull();
      expect(yield* next).toEqual([{ current: second, kept: [second.version, first.version] }]);
      expect(yield* store.followPage('deadbeef1234').pipe(Stream.take(1), Stream.runCollect)).toEqual([{ current: null, kept: [] }]);
    }),
  );

  it.effect('closing the shelf ends a follower whose consumer scope is still open', () =>
    Effect.gen(function* () {
      const { root } = yield* workspace();
      const lifetime = yield* Scope.fork(yield* Effect.scope);
      const store = yield* versionedShelf(root, 'http://localhost:5634').pipe(Effect.provideService(Scope.Scope, lifetime));
      const next = yield* Stream.toPull(store.follow(['lead'], 1));
      expect(yield* next).toEqual([{ pages: [], total: 0 }]);
      yield* Scope.close(lifetime, Exit.void);
      expect(Exit.isFailure(yield* Effect.exit(next))).toBe(true);
    }),
  );

  it.effect('closing the shelf also ends an initial follow still waiting for its worker', () =>
    Effect.gen(function* () {
      const { root, page } = yield* workspace();
      const lifetime = yield* Scope.fork(yield* Effect.scope);
      const store = yield* versionedShelf(root, 'http://localhost:5634').pipe(Effect.provideService(Scope.Scope, lifetime));
      const ActualWorker = globalThis.Worker;
      let worker: Worker | undefined;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          globalThis.Worker = class extends ActualWorker {
            constructor(...input: ConstructorParameters<typeof ActualWorker>) {
              super(...input);
              worker = this;
            }
          };
        }),
        () =>
          Effect.sync(() => {
            globalThis.Worker = ActualWorker;
          }),
      );
      yield* publish(store, { path: yield* page('opening.html', '<title>Opening</title>') });
      const running = worker!;
      const send = running.postMessage.bind(running);
      let deliver: (() => void) | undefined;
      let announced: (() => void) | undefined;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          spyOn(running, 'postMessage').mockImplementation((message) => {
            deliver = () => send(message);
            announced?.();
          }),
        ),
        (mock) => Effect.sync(() => mock.mockRestore()),
      );
      const next = yield* Stream.toPull(store.follow(['lead'], 1));
      const reading = yield* Effect.forkScoped(Effect.exit(next));
      yield* Effect.callback<void>((resume) => {
        announced = () => resume(Effect.void);
        if (deliver !== undefined) announced();
      });
      const closing = yield* Effect.forkScoped(Scope.close(lifetime, Exit.void));
      yield* Effect.yieldNow;
      deliver!();
      expect(Exit.isFailure(yield* Fiber.join(reading))).toBe(true);
      yield* Fiber.join(closing);
    }),
  );

  it.effect('a partially applied publish ends live readers and a fresh follow restores the durable page', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { store, root, page } = yield* workspace();
      const first = yield* publish(store, { path: yield* page('partial.html', '<title>Before</title>') });
      const next = yield* Stream.toPull(store.follow(['lead'], 2));
      expect((yield* next)[0]?.pages[0]?.artifact.version).toBe(first.version);
      const claim = join(root, 'threads', createHash('sha256').update('stranger').digest('hex').slice(0, 24));
      yield* fs.makeDirectory(claim);
      expect(Exit.isFailure(yield* Effect.exit(publish(store, { path: first.sourcePath, thread: 'stranger', title: 'After' })))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(next))).toBe(true);
      const durable = yield* store.page(first.id);
      expect(durable?.record.title).toBe('After');
      const other = yield* publish(store, { path: yield* page('other.html', '<title>Other</title>') });
      const [restored] = yield* store.follow(['lead'], 2).pipe(Stream.take(1), Stream.runCollect);
      expect(restored?.total).toBe(2);
      expect(restored?.pages.find((row) => row.artifact.id === first.id)?.artifact.version).toBe(durable?.record.version);
      expect(restored?.pages.find((row) => row.artifact.id === other.id)?.artifact.version).toBe(other.version);
    }),
  );
});
