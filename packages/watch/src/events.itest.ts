import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { chmod, mkdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Clock, Effect, Queue } from 'effect';
import { makeWatchClient } from './client.js';
import { changesUntil, hearing, lastOf, naming, TREE, world as worldAt } from './testing/hearing.js';

const world = () => worldAt('watch-events-');

it.live(
  'a file replaced atomically and deleted at once is heard deleted, one deleted and made again alive, one renamed in case under its new name',
  () =>
    Effect.gen(function* () {
      const { tree, place } = yield* world();
      yield* Effect.promise(() =>
        Promise.all([writeFile(join(tree, 'replaced'), 'x'), writeFile(join(tree, 'remade'), 'x'), writeFile(join(tree, 'cased'), 'x')]),
      );
      const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
      const deep = yield* hearing;
      yield* client.subscribe(tree, TREE, deep.into);
      yield* Effect.promise(async () => {
        await writeFile(join(tree, 'replaced.next'), 'y');
        await rename(join(tree, 'replaced.next'), join(tree, 'replaced'));
        await rm(join(tree, 'replaced'));
        await rm(join(tree, 'remade'));
        await writeFile(join(tree, 'remade'), 'y');
        await rename(join(tree, 'cased'), join(tree, 'CASED'));
        await writeFile(join(tree, 'marker'), 'x');
      });
      const seen = yield* changesUntil(deep.heard, naming('marker'));
      expect({
        replaced: lastOf(seen, 'replaced'),
        remade: lastOf(seen, 'remade') === 'delete',
        cased: [lastOf(seen, 'cased'), lastOf(seen, 'CASED')],
      }).toEqual({ replaced: 'delete', remade: false, cased: ['delete', 'create'] });
    }),
);

it.live(
  'a directory remade keeps being watched, a FIFO renamed over a file stops nothing, a link is not followed, an exclusion ends at its name, and names keep their bytes',
  () =>
    Effect.gen(function* () {
      const { dir, tree, place } = yield* world();
      const composed = 'n\u00e9';
      const decomposed = 'd\u0065\u0301';
      yield* Effect.promise(async () => {
        await mkdir(join(tree, 'redo'));
        await mkdir(join(tree, 'ex'));
        await mkdir(join(dir, 'target'));
        await writeFile(join(tree, 'log'), 'x');
      });
      const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
      const deep = yield* hearing;
      yield* client.subscribe(tree, { recursive: true, ignore: ['ex'] }, deep.into);
      yield* Effect.promise(async () => {
        await rm(join(tree, 'redo'), { recursive: true });
        await mkdir(join(tree, 'redo'));
        await writeFile(join(tree, 'redo', 'first'), 'x');
        if (Bun.spawnSync(['mkfifo', join(tree, 'log.next')]).exitCode !== 0) throw new Error('mkfifo failed');
        await rename(join(tree, 'log.next'), join(tree, 'log'));
        await symlink(join(dir, 'target'), join(tree, 'link'));
        await writeFile(join(dir, 'target', 'inside'), 'x');
        await writeFile(join(tree, 'ex', 'hidden'), 'x');
        await writeFile(join(tree, 'exx'), 'x');
        await writeFile(join(tree, composed), 'x');
        await writeFile(join(tree, decomposed), 'x');
      });
      const first = yield* changesUntil(deep.heard, (seen) =>
        [composed, decomposed, 'exx', 'redo/first', 'link'].every((path) => naming(path)(seen)),
      );
      yield* Effect.promise(() => writeFile(join(tree, 'redo', 'second'), 'x'));
      const second = yield* changesUntil(deep.heard, naming('redo/second'));
      const heard = [...first, ...second];
      expect({
        log: lastOf(heard, 'log') !== undefined,
        linked: heard.some((change) => change.path.startsWith('link/')),
        excluded: heard.some((change) => change.path.startsWith('ex/') || change.path === 'ex'),
      }).toEqual({ log: true, linked: false, excluded: false });
    }),
);

it.live(
  'a directory renamed with its files names the new paths of its children live and since a snapshot, keeps watching them there, and forgets one moved away',
  () =>
    Effect.gen(function* () {
      const { dir, tree, place } = yield* world();
      yield* Effect.promise(async () => {
        await mkdir(join(tree, 'before', 'deep'), { recursive: true });
        await mkdir(join(tree, 'leaving', 'inner'), { recursive: true });
        await writeFile(join(tree, 'before', 'file'), 'x');
        await writeFile(join(tree, 'before', 'deep', 'file'), 'x');
        await writeFile(join(tree, 'kept'), 'old');
      });
      const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
      const deep = yield* hearing;
      yield* client.subscribe(tree, TREE, deep.into);
      const position = yield* client.mark(tree, join(dir, 'mark'), [], true);
      yield* Effect.promise(async () => {
        const { mtime } = await stat(join(tree, 'kept'));
        await writeFile(join(tree, 'kept.next'), 'new');
        await utimes(join(tree, 'kept.next'), mtime, mtime);
        await rename(join(tree, 'kept.next'), join(tree, 'kept'));
        await rename(join(tree, 'before'), join(tree, 'after'));
        await rename(join(tree, 'leaving'), join(dir, 'left'));
      });
      const wanted = ['after/file', 'after/deep/file'];
      const live = yield* changesUntil(deep.heard, (seen) => wanted.every((path) => naming(path)(seen)) && naming('before')(seen));
      yield* Effect.promise(async () => {
        await writeFile(join(dir, 'left', 'inner', 'outside'), 'x');
        await writeFile(join(tree, 'after', 'deep', 'later'), 'x');
      });
      const later = yield* changesUntil(deep.heard, naming('after/deep/later'));
      const fresh = yield* makeWatchClient({ dir: join(dir, 'fresh'), lifetime: 'with-client' });
      const since = (yield* fresh.changedSince(tree, position, [])) ?? [];
      expect({
        gone: lastOf(live, 'before'),
        named: wanted.map((path) => lastOf(live, path)),
        since: [...wanted, 'kept'].filter((path) => !naming(path)(since)),
        stale: since.some((change) => change.path.startsWith('before/') && change.kind !== 'delete'),
        outside: [...live, ...later].some((change) => change.path.startsWith('leaving/') && change.kind !== 'delete'),
      }).toEqual({ gone: 'delete', named: ['create', 'create'], since: [], stale: false, outside: false });
    }),
);

it.live(
  'a root deleted while its subscription closes, or renamed away, ends its watch and leaves the watch process serving the next one',
  () =>
    Effect.gen(function* () {
      const { dir, tree, place } = yield* world();
      const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
      const watchers = () => Bun.spawnSync(['pgrep', '-f', place]).stdout.toString().trim();
      const root = join(tree, 'closing');
      yield* Effect.promise(() => mkdir(join(root, 'inside'), { recursive: true }));
      const doomed = yield* hearing;
      const subscription = yield* client.subscribe(root, TREE, doomed.into);
      yield* Effect.all([subscription.close, Effect.promise(() => rm(root, { recursive: true, force: true }))], { concurrency: 2 });
      const moving = join(tree, 'moving');
      yield* Effect.promise(() => mkdir(moving));
      const moved = yield* hearing;
      yield* client.subscribe(moving, TREE, moved.into);
      yield* Effect.promise(() => rename(moving, join(tree, 'moved')));
      let ended = false;
      while (!ended) ended = 'ended' in (yield* Queue.take(moved.heard));
      const replaced = join(tree, 'replaced');
      yield* Effect.promise(() => mkdir(replaced));
      const replacing = yield* hearing;
      yield* client.subscribe(replaced, TREE, replacing.into);
      yield* Effect.promise(async () => {
        await rename(replaced, join(tree, 'replaced-away'));
        await mkdir(replaced);
        await writeFile(join(replaced, 'inside'), 'x');
      });
      let settled = false;
      while (!settled) {
        const one = yield* Queue.take(replacing.heard);
        settled = 'ended' in one || ('changes' in one && one.changes.some((change) => change.path === 'inside'));
      }
      const before = watchers();
      const next = yield* hearing;
      const other = join(dir, 'other');
      yield* Effect.promise(() => mkdir(other));
      yield* client.subscribe(other, TREE, next.into);
      yield* Effect.promise(() => writeFile(join(other, 'after'), 'x'));
      yield* changesUntil(next.heard, naming('after'));
      expect({ alive: before !== '', same: watchers() === before }).toEqual({ alive: true, same: true });
    }),
);

it.live('a root whose ancestor is renamed away or deleted ends its watch though nothing inside it changed', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const watch = Effect.fnUntraced(function* (ancestor: string, leave: () => Promise<void>) {
      yield* Effect.promise(() => mkdir(join(tree, ancestor, 'middle', 'root'), { recursive: true }));
      const heard = yield* hearing;
      yield* client.subscribe(join(tree, ancestor, 'middle', 'root'), TREE, heard.into);
      yield* Effect.promise(leave);
      return yield* Queue.take(heard.heard);
    });
    const renamed = yield* watch('renamed', () => rename(join(tree, 'renamed'), join(tree, 'renamed-away')));
    const deleted = yield* watch('deleted', () => rm(join(tree, 'deleted'), { recursive: true }));
    expect([renamed, deleted]).toEqual([{ ended: expect.any(String) }, { ended: expect.any(String) }]);
  }),
);

it.live('a root whose ancestor sits in an unreadable directory still ends its watch when that ancestor is renamed', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const hidden = join(tree, 'hidden');
    yield* Effect.promise(() => mkdir(join(hidden, 'middle', 'root'), { recursive: true }));
    yield* Effect.addFinalizer(() => Effect.promise(() => chmod(hidden, 0o700)));
    yield* Effect.promise(() => chmod(hidden, 0o300));
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const heard = yield* hearing;
    yield* client.subscribe(join(hidden, 'middle', 'root'), TREE, heard.into);
    yield* Effect.promise(() => rename(join(hidden, 'middle'), join(hidden, 'middle-away')));
    expect(yield* Queue.take(heard.heard)).toEqual({ ended: expect.any(String) });
  }),
);

it.live('two subscriptions on one root with different exclusions each hear their own, and one closing leaves the other hearing', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    yield* Effect.promise(async () => {
      await mkdir(join(tree, 'x'));
      await mkdir(join(tree, 'y'));
    });
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    const narrow = yield* hearing;
    const wide = yield* hearing;
    const closing = yield* client.subscribe(tree, { recursive: true, ignore: ['x'] }, narrow.into);
    yield* client.subscribe(tree, TREE, wide.into);
    yield* Effect.promise(async () => {
      await writeFile(join(tree, 'x', 'f'), '');
      await writeFile(join(tree, 'y', 'f'), '');
    });
    const fromNarrow = yield* changesUntil(narrow.heard, naming('y/f'));
    const fromWide = yield* changesUntil(wide.heard, (seen) => naming('x/f')(seen) && naming('y/f')(seen));
    yield* closing.close;
    yield* Effect.promise(() => writeFile(join(tree, 'x', 'g'), ''));
    yield* changesUntil(wide.heard, naming('x/g'));
    expect({ narrow: fromNarrow.some((change) => change.path.startsWith('x')), wide: fromWide.length > 0 }).toEqual({
      narrow: false,
      wide: true,
    });
  }),
);

it.live('a write made just before a settle is in what changed since the mark, with the moment it was heard, and no cookie is', () =>
  Effect.gen(function* () {
    const { tree, place } = yield* world();
    const client = yield* makeWatchClient({ dir: place, lifetime: 'with-client' });
    yield* client.subscribe(tree, TREE, (yield* hearing).into);
    const position = yield* client.mark(tree, null, [], false);
    const before = yield* Clock.currentTimeMillis;
    yield* Effect.promise(() => writeFile(join(tree, 'late'), 'x'));
    const settled = yield* client.settle(tree, []);
    const after = yield* Clock.currentTimeMillis;
    const changes = (yield* client.changedSince(tree, position, [])) ?? [];
    const late = changes.find((change) => change.path === 'late');
    expect({
      named: settled && late !== undefined,
      heard: late?.heard !== undefined && late.heard.from >= before && late.heard.from <= late.heard.to && late.heard.to <= after,
      cookies: changes.some((change) => change.path.startsWith('.watch-cookie-')),
    }).toEqual({ named: true, heard: true, cookies: false });
  }),
);
