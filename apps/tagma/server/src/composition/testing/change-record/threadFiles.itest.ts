import { retiredAt } from '../../../change-record/testing/holdings.js';
import { holderKey } from '../../../workspace/contract/wire/checkout.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { contentDigest } from '@runlith/files/content';
import { authorshipRefusal, READING_CAPTURE } from '../../../change-record/threadFiles/failures.js';
import { readPicture } from '../../../workspace/checkouts/picture.js';
import { MINE, THEIRS, GONE, BORN, GROWN, run, edited, fixture, layers, only, entriesOf, changed, record } from './threadFilesWorld.js';
type World = Effect.Success<typeof fixture>;
const held = Effect.fnUntraced(function* (world: World, threads: readonly string[]) {
  yield* world.holdings.settled(world.rootId);
  const totals = yield* world.holdings.threads(threads);
  return [...totals].flatMap(([thread, total]) => (total.paths > 0 ? [[thread, total.paths] as const] : []));
});
const moved = (world: World) => Effect.andThen(world.holdings.moved(world.rootId, 'all'), world.holdings.settled(world.rootId));
layer(layers, { excludeTestServices: true })('thread files', (it) => {
  it.effect('a path written in the run that is going reads writing, and settled once the run has ended', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const runId = 'run-one';
      yield* world.store.db.run(sql`update thread set running_run_id = ${runId} where id = ${MINE}`);
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      const moving = only(yield* world.list());
      expect(moving).toMatchObject({ path: 'kept.txt', writing: true, lines: { added: 1, removed: 0 }, others: [] });
      yield* world.store.db.run(sql`update thread set running_run_id = null where id = ${MINE}`);
      yield* world.holdings.annotate(MINE);
      expect(only(yield* world.list()).writing).toBe(false);
      yield* world.files.writeFileString(world.paths.join(world.root, 'kept.txt'), BORN);
      yield* moved(world);
      expect(entriesOf(yield* world.list())).toEqual([]);
    }),
  );
  it.effect(
    'held-path counts follow surviving ownership through a revert, and a write back to a version the chain held restores its marks',
    () =>
      Effect.gen(function* () {
        const world = yield* fixture;
        const at = world.paths.join(world.root, 'kept.txt');
        yield* record(world.mine, {
          origin: 'write',
          path: world.paths.join(world.root, '..', 'notes.txt'),
          at: new Date(yield* Clock.currentTimeMillis),
          after: contentDigest('note'),
          afterText: 'note',
        });
        yield* world.files.writeFileString(at, GROWN);
        yield* edited(world.mine, at, BORN, GROWN);
        expect(yield* held(world, [MINE, THEIRS])).toEqual([[MINE, 1]]);
        yield* world.files.writeFileString(at, BORN);
        yield* edited(world.mine, at, GROWN, BORN);
        expect(yield* held(world, [MINE, THEIRS])).toEqual([]);
        yield* world.files.writeFileString(at, GROWN);
        yield* edited(world.theirs, at, BORN, GROWN);
        expect(yield* held(world, [MINE, THEIRS])).toEqual([[MINE, 1]]);
      }),
  );
  it.effect('a kept held count yields to bytes changed outside the record', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      const touched = new Date((yield* Clock.currentTimeMillis) - 60000);
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      expect(yield* held(world, [MINE])).toEqual([[MINE, 1]]);
      expect(yield* held(world, [MINE])).toEqual([[MINE, 1]]);
      yield* world.files.writeFileString(at, BORN);
      yield* world.files.utimes(at, touched, touched);
      yield* moved(world);
      expect(yield* held(world, [MINE])).toEqual([]);
    }),
  );
  it.effect('a peer replacing a contribution updates both writers surviving-file counts', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const counts = new Map<string, number>();
      const publish = ({ threadId }: { readonly threadId: string | null }) =>
        threadId === null
          ? Effect.void
          : Effect.map(Effect.orDie(held(world, [threadId])), (read) => {
              counts.set(threadId, new Map(read).get(threadId) ?? 0);
            });
      const writer = (threadId: string) => world.writer(threadId, publish);
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(yield* writer(MINE), at, BORN, GROWN);
      expect(counts.get(MINE)).toBe(1);
      const replaced = 'one\nforeign\n';
      yield* world.files.writeFileString(at, replaced);
      yield* edited(yield* writer(THEIRS), at, GROWN, replaced);
      expect(counts.get(MINE)).toBe(0);
      expect(counts.get(THEIRS)).toBe(1);
    }),
  );
  it.effect('a path another session holds outstanding rows on names that session beside the word', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      yield* world.files.writeFileString(at, `${GROWN}three\n`);
      yield* edited(world.theirs, at, GROWN, `${GROWN}three\n`);
      yield* world.files.writeFileString(at, `${GROWN}three\nfour\n`);
      yield* edited(world.gone, at, `${GROWN}three\n`, `${GROWN}three\nfour\n`);
      const shared = only(yield* world.list());
      expect(shared.writing).toBe(false);
      expect([...shared.others].sort((left, right) => holderKey(left.holder).localeCompare(holderKey(right.holder)))).toEqual(
        [
          { holder: { kind: 'thread' as const, thread: THEIRS }, retired: false },
          { holder: { kind: 'thread' as const, thread: GONE }, retired: false },
        ].sort((left, right) => holderKey(left.holder).localeCompare(holderKey(right.holder))),
      );
    }),
  );
  it.effect('each path carries the status word the checkout row lists it under', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const kept = world.paths.join(world.root, 'kept.txt');
      const born = world.paths.join(world.root, 'born.txt');
      const loose = world.paths.join(world.root, 'loose.txt');
      yield* world.files.writeFileString(kept, GROWN);
      yield* edited(world.mine, kept, BORN, GROWN);
      yield* world.files.writeFileString(born, 'new\n');
      yield* edited(world.mine, born, '', 'new\n');
      yield* run(world.git, world.root, ['add', 'born.txt']);
      yield* world.files.writeFileString(loose, 'loose\n');
      yield* edited(world.mine, loose, '', 'loose\n');
      yield* world.checkouts.mark(world.rootId, 'index');
      const words = new Map(entriesOf(yield* world.list()).map((entry) => [entry.path, entry.section === 'outside' ? null : entry.git]));
      expect(words.get('kept.txt')).toBe('modified');
      expect(words.get('born.txt')).toBe('added');
      expect(words.get('loose.txt')).toBe('untracked');
    }),
  );
  it.effect('ignored files written by a thread count outside its held paths and keep their authors', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.files.writeFileString(world.paths.join(world.root, '.git/info/exclude'), '*.draft\n');
      for (const [path, text, port] of [
        ['one.draft', 'one', world.mine],
        ['two.draft', 'two\n', world.mine],
        ['empty.draft', '', world.mine],
        ['other.draft', 'other\n', world.theirs],
      ] as const) {
        const at = world.paths.join(world.root, path);
        yield* world.files.writeFileString(at, text);
        yield* record(port, {
          origin: 'write',
          path: at,
          at: new Date(yield* Clock.currentTimeMillis),
          after: contentDigest(text),
          afterText: text,
          hunk: workspaceChangeHunk('', text),
          mode: '100644',
        });
      }
      expect(yield* run(world.git, world.root, ['status', '--porcelain'])).toBe('');
      const list = yield* world.list();
      expect(list.checkouts.map((one) => one.state.kind)).toEqual(['current']);
      expect(
        entriesOf(list)
          .map((entry) => [entry.section, entry.path])
          .sort(),
      ).toEqual([
        ['outside', 'empty.draft'],
        ['outside', 'one.draft'],
        ['outside', 'two.draft'],
      ]);
      const totals = yield* world.holdings.threads([MINE, THEIRS]);
      expect(totals.get(MINE)).toEqual({ paths: 0, unproven: 0, outside: 3 });
      expect(totals.get(THEIRS)).toEqual({ paths: 0, unproven: 0, outside: 1 });
      const diff = yield* world.authorship.read(world.rootId, 'one.draft');
      expect(changed(diff)).toEqual([{ kind: 'added', text: 'one', author: MINE }]);
      const empty = yield* world.authorship.read(world.rootId, 'empty.draft');
      expect(empty.sides).toEqual({ before: null, after: 'empty.draft' });
    }),
  );
  it.effect('a binary path answers binary and no lines', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'blob.bin');
      const bytes = `head${String.fromCharCode(0)}tail\n`;
      yield* world.files.writeFileString(at, bytes);
      yield* edited(world.mine, at, '', bytes);
      const answer = yield* world.authorship.read(world.rootId, 'blob.bin');
      expect(answer.binary).toBe(true);
      expect(answer.lines).toEqual([]);
      expect(only(yield* world.list()).lines).toBe('unweighed');
    }),
  );
  it.effect('a path in neither HEAD nor the tree refuses not-found', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const missing = yield* Effect.result(world.authorship.read(world.rootId, 'no/such.txt'));
      expect(missing._tag === 'Failure' ? authorshipRefusal(missing.failure).code : null).toBe('not-found');
    }),
  );
  it.effect(
    'a staged half reads HEAD against the index and an unstaged half the index against the working file, where the whole working change reads nothing',
    () =>
      Effect.gen(function* () {
        const world = yield* fixture;
        const at = world.paths.join(world.root, 'kept.txt');
        yield* world.files.writeFileString(at, GROWN);
        yield* run(world.git, world.root, ['add', 'kept.txt']);
        yield* world.files.writeFileString(at, BORN);
        const whole = yield* world.authorship.read(world.rootId, 'kept.txt');
        const staged = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, undefined, undefined, 'staged');
        const unstaged = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, undefined, undefined, 'unstaged');
        expect(changed(whole)).toEqual([]);
        expect(whole.sides).toEqual({ before: 'kept.txt', after: 'kept.txt' });
        expect(changed(staged)).toEqual([{ kind: 'added', text: 'two', author: null }]);
        expect(changed(unstaged)).toEqual([{ kind: 'removed', text: 'two', author: null }]);
      }),
  );
  it.effect('a half that is the whole working change is the plain reading, its authors named', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      yield* run(world.git, world.root, ['add', 'kept.txt']);
      const staged = yield* world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, undefined, undefined, 'staged');
      expect(changed(staged)).toEqual([{ kind: 'added', text: 'two', author: MINE }]);
    }),
  );
  it.effect('a working file past the capture reads binary when its first bytes hold a NUL, and still refuses when they do not', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const big = new Uint8Array(READING_CAPTURE + 1).fill(0x61);
      big[16] = 0;
      yield* world.files.writeFile(world.paths.join(world.root, 'shot.png'), big);
      yield* world.files.writeFile(world.paths.join(world.root, 'long.txt'), new Uint8Array(READING_CAPTURE + 1).fill(0x61));
      const picture = yield* world.authorship.read(world.rootId, 'shot.png');
      const text = yield* Effect.result(world.authorship.read(world.rootId, 'long.txt'));
      expect(picture.binary).toBe(true);
      expect(picture.sides).toEqual({ before: null, after: 'shot.png' });
      expect(text._tag === 'Failure' ? authorshipRefusal(text.failure).code : null).toBe('path-oversized');
    }),
  );
  it.effect('a half named beside a commit refuses side-with-commit', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const mixed = yield* Effect.result(
        world.authorship.read(world.rootId, 'kept.txt', undefined, undefined, 'HEAD', undefined, 'staged'),
      );
      expect(mixed._tag === 'Failure' ? authorshipRefusal(mixed.failure).code : null).toBe('side-with-commit');
    }),
  );
  it.effect('a picture is answered as its bytes with the type they open with, and a file that is no picture refuses', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      yield* world.files.writeFile(world.paths.join(world.root, 'mark.png'), png);
      const shown = yield* readPicture(world.roots, world.git, world.files, world.rootId, 'mark.png', 'working');
      const text = yield* Effect.result(readPicture(world.roots, world.git, world.files, world.rootId, 'kept.txt', 'HEAD'));
      const absent = yield* Effect.result(readPicture(world.roots, world.git, world.files, world.rootId, 'mark.png', 'HEAD'));
      expect(shown).toEqual({ bytes: png, mediaType: 'image/png' });
      expect(text._tag === 'Failure' ? authorshipRefusal(text.failure).code : null).toBe('not-a-picture');
      expect(absent._tag === 'Failure' ? authorshipRefusal(absent.failure).code : null).toBe('not-found');
    }),
  );
  it.effect('a path something outside the record wrote over leaves the thread, its lines are nobody’s', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      yield* world.files.writeFileString(at, 'rewritten by a terminal\n');
      yield* moved(world);
      expect(entriesOf(yield* world.list())).toEqual([]);
      const view = yield* world.holdings.read(world.rootId);
      expect(view.paths.map((one) => one.verdict)).toMatchObject([
        { verdict: 'proven', hands: [], nobody: [{ why: { kind: 'external' } }] },
      ]);
    }),
  );
  it.effect('a path the branch carried leaves the list, and its commit stands among the thread commits', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      yield* edited(world.mine, at, BORN, GROWN);
      expect(entriesOf(yield* world.list()).map((entry) => entry.section)).toEqual(['uncommitted']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'carried', '--', 'kept.txt']);
      yield* Effect.orDie(retiredAt(world.store, world.units, world.git, world.root, world.rootId));
      yield* moved(world);
      const head = yield* run(world.git, world.root, ['rev-parse', 'HEAD']);
      const after = yield* world.list();
      expect(entriesOf(after)).toEqual([]);
      expect(after.commits.map((commit) => commit.sha)).toEqual([head]);
    }),
  );
  it.effect('a path that escapes the root and the graph tree are refused, and nothing is read for either', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.files.writeFileString(world.paths.join(world.root, '..', 'secret.txt'), 'a secret\n');
      const read = world.blobs.read;
      const escaped = yield* Effect.result(world.authorship.read(world.rootId, '../secret.txt'));
      const graph = yield* Effect.result(world.authorship.read(world.rootId, '.tagma/blocks/one.md'));
      expect(escaped._tag === 'Failure' ? authorshipRefusal(escaped.failure).code : null).toBe('path-outside-tree');
      expect(graph._tag === 'Failure' ? authorshipRefusal(graph.failure).code : null).toBe('graph-path');
      expect(world.blobs.read).toBe(read);
    }),
  );
});
