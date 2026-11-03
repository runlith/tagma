import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, FileSystem, Result } from 'effect';
import type { Folder } from '../../../change-record/holdings/judge.js';
import { workspaceChangeContent, changeLogWrites } from '../../../change-record/store/tables.js';
import { contentDigest } from '@runlith/files/content';
import { holderKey } from '../../../workspace/contract/wire/checkout.js';
import { Git, GitEndingUnreadable } from '@runlith/git/Git';
import type { Holding } from '../../../change-record/contract/wire/holdings.js';
import { foldInline } from '../../../change-record/testing/holdings.js';
import { makeJudges } from '../../../change-record/holdings/judges.js';
import { makeGitMetadata } from '../../../change-record/record/metadata.js';
import { FoldMemory } from '../../../change-record/lines/memory.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { CheckoutRows, GraphDirectory } from '../../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import { commandUnattributed, unattributedWrites } from '../../../change-record/store/commandTables.js';
import { BORN, GROWN, MINE, PROJECT, THEIRS, edited, fixture, layers, record, run } from './threadFilesWorld.js';
type World = Effect.Success<typeof fixture>;
const judgesOf = (world: World, git: Git['Service'] = world.git, folder: Folder = foldInline) =>
  Effect.flatMap(makeGitMetadata, (metadata) => makeJudges({ folder, walks: world.walks, memory: new FoldMemory(1 << 26), metadata })).pipe(
    Effect.provideService(MachineStore, world.store),
    Effect.provideService(MachineUnits, world.units),
    Effect.provideService(Git, git),
    Effect.provideService(FileSystem.FileSystem, world.files),
    Effect.provideService(FileRoots, world.roots),
    Effect.provideService(CheckoutRows, world.checkouts),
    Effect.provideService(GraphDirectory, '.tagma'),
  );
const written = (world: World, path: string, text: string) => world.files.writeFileString(world.paths.join(world.root, path), text);
const proven = (holding: Holding | undefined) => {
  expect(holding?.verdict.verdict).toBe('proven');
  return holding?.verdict.verdict === 'proven' ? holding.verdict : { hands: [], nobody: [] };
};
const blobOf = (world: World, path: string) => run(world.git, world.root, ['rev-parse', `HEAD:${path}`]);
const poisoned = (git: Git['Service'], poison: (oid: string) => boolean): Git['Service'] => ({
  run: git.run,
  objects: (dir, oids, options) =>
    Effect.map(git.objects!(dir, oids, options), (answers) =>
      answers.map((answer, at) =>
        poison(oids[at] as string)
          ? Result.fail(new GitEndingUnreadable({ command: ['cat-file'], reason: 'the object store is damaged' }))
          : answer,
      ),
    ),
});
const silenced = <A, E, R>(job: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const warn = console.warn;
      console.warn = () => undefined;
      return warn;
    }),
    () => job,
    (warn) => Effect.sync(() => (console.warn = warn)),
  );
layer(layers, { excludeTestServices: true })('Holdings of one checkout', (it) => {
  it.effect('checkout holders are read after the request even when its first empty judgment already settled', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const judges = yield* judgesOf(world);
      expect(yield* judges.read(world.rootId, 'settled')).toMatchObject({ state: { kind: 'current' }, paths: [] });
      yield* written(world, 'kept.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      const view = yield* Effect.andThen(judges.moved(world.rootId, ['kept.txt']), judges.read(world.rootId, 'settled'));
      expect(view.state).toEqual({ kind: 'current' });
      const holders = yield* judges.holdersOf(world.rootId, ['kept.txt']);
      expect(holders.get('kept.txt')?.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
    }),
  );
  it.effect('every path stands in one state, and a proven path splits its diff among its hands and nobody', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const zero = `zero\n${GROWN}`;
      yield* written(world, 'kept.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      yield* written(world, 'kept.txt', zero);
      yield* edited(world.theirs, world.paths.join(world.root, 'kept.txt'), GROWN, zero);
      yield* written(world, '.gitignore', '*.log\n');
      yield* written(world, 'trace.log', 'traced\n');
      yield* record(world.mine, {
        origin: 'write',
        path: world.paths.join(world.root, 'trace.log'),
        at: new Date(yield* Clock.currentTimeMillis),
        after: contentDigest('traced\n'),
        afterText: 'traced\n',
        mode: '100644',
      });
      yield* written(world, 'stray.txt', 'nobody wrote this\n');
      const judges = yield* judgesOf(world);
      yield* judges.follow(world.rootId);
      const judged = yield* judges.judged(world.rootId, ['kept.txt', 'trace.log', 'stray.txt']);
      const kept = judged.get('kept.txt')?.holding;
      const hands = proven(kept).hands;
      expect(hands.map((hand) => [holderKey(hand.holder), hand.added, hand.removed]).sort()).toEqual([
        [MINE, 1, 0],
        [THEIRS, 1, 0],
      ]);
      expect(kept?.lines).toEqual({ added: 2, removed: 0 });
      expect(kept?.git).toBe('modified');
      const stray = judged.get('stray.txt')?.holding;
      expect(proven(stray)).toMatchObject({ hands: [], nobody: [{ added: 1, removed: 0, why: { kind: 'external' } }] });
      expect(judged.get('trace.log')?.holding.git).toBe('ignored');
      const totals = yield* judges.threads([MINE, THEIRS]);
      expect(totals.get(MINE)).toEqual({ paths: 1, unproven: 0, outside: 1 });
      expect(totals.get(THEIRS)).toEqual({ paths: 1, unproven: 0, outside: 0 });
    }),
  );
  it.effect('a replaced HEAD tree does not replace the raw base of recorded lines', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const tree = yield* run(world.git, world.root, ['rev-parse', 'HEAD^{tree}']);
      yield* written(world, 'kept.txt', 'replacement\n');
      yield* run(world.git, world.root, ['add', 'kept.txt']);
      const replacement = yield* run(world.git, world.root, ['write-tree']);
      yield* run(world.git, world.root, ['read-tree', 'HEAD']);
      yield* run(world.git, world.root, ['replace', tree, replacement]);
      yield* written(world, 'kept.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      const judges = yield* judgesOf(world);
      const holding = (yield* judges.judged(world.rootId, ['kept.txt'])).get('kept.txt')?.holding;
      expect(holding?.lines).toEqual({ added: 1, removed: 0 });
      expect(proven(holding)).toMatchObject({ hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }], nobody: [] });
    }),
  );
  it.effect('a registered subdirectory judges paths against its own prefix in the enclosing repository', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const sub = world.paths.join(world.root, 'sub');
      yield* world.files.makeDirectory(sub);
      yield* written(world, 'kept.txt', 'outer\n');
      yield* written(world, 'sub/kept.txt', BORN);
      yield* run(world.git, world.root, ['add', '-A']);
      yield* run(world.git, world.root, ['commit', '-qm', 'nested root']);
      const nested = yield* world.roots.register({ path: sub, provenance: { kind: 'adoption', id: 'nested' } });
      yield* written(world, 'sub/kept.txt', GROWN);
      const judges = yield* judgesOf(world);
      const holding = (yield* judges.judged(nested.rootId, ['kept.txt'])).get('kept.txt')?.holding;
      expect(holding?.lines).toEqual({ added: 1, removed: 0 });
      expect(proven(holding).nobody).toMatchObject([{ added: 1, removed: 0 }]);
    }),
  );
  it.effect('a leading U+FEFF belongs to the tracked filename', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const name = '\uFEFFkept.txt';
      yield* written(world, name, BORN);
      yield* run(world.git, world.root, ['add', '--', name]);
      yield* run(world.git, world.root, ['commit', '-qm', 'literal name']);
      yield* written(world, name, GROWN);
      yield* edited(world.mine, world.paths.join(world.root, name), BORN, GROWN);
      const judges = yield* judgesOf(world);
      const holding = (yield* judges.judged(world.rootId, [name])).get(name)?.holding;
      expect(holding?.lines).toEqual({ added: 1, removed: 0 });
      expect(proven(holding)).toMatchObject({ hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }], nobody: [] });
    }),
  );
  it.effect('a change two sessions’ commands overlapped names every one of those sessions, not the last to retain it', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* written(world, 'stray.txt', 'a formatter wrote this\n');
      yield* world.units.write(unattributedWrites, (unit) =>
        unit.run(
          world.store.db.insert(commandUnattributed).values([
            { projectId: PROJECT, threadId: THEIRS, checkout: world.rootId, path: 'stray.txt', reason: 'overlap', at: 1 },
            { projectId: PROJECT, threadId: MINE, checkout: world.rootId, path: 'stray.txt', reason: 'overlap', at: 2 },
          ]),
        ),
      );
      const judges = yield* judgesOf(world);
      const holding = (yield* judges.judged(world.rootId, ['stray.txt'])).get('stray.txt')?.holding;
      expect(proven(holding).nobody).toEqual([
        {
          added: 1,
          removed: 0,
          why: {
            kind: 'unattributed',
            windows: [
              { thread: MINE, reason: 'overlap', team: null },
              { thread: THEIRS, reason: 'overlap', team: null },
            ],
          },
        },
      ]);
    }),
  );
  it.effect('a missing recorded version still proves its inline edit beside an external addition', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      yield* world.units.write(changeLogWrites, (unit) => unit.run(world.store.db.delete(workspaceChangeContent)));
      yield* written(world, 'kept.txt', `${GROWN}external\n`);
      const judges = yield* judgesOf(world);
      const holding = (yield* judges.judged(world.rootId, ['kept.txt'])).get('kept.txt')?.holding;
      expect(proven(holding)).toMatchObject({
        hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }],
        nobody: [{ added: 1, removed: 0, why: { kind: 'external' } }],
      });
    }),
  );
  it.effect('checkout marks name local changes and widen git policy changes', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.checkouts.follow(world.rootId);
      const marks: (readonly string[] | undefined)[] = [];
      const stop = world.checkouts.onMark((_rootId, paths) => Effect.sync(() => void marks.push(paths)));
      yield* world.checkouts.mark(world.rootId, 'written', ['kept.txt']);
      yield* world.checkouts.mark(world.rootId, 'written', ['.gitignore']);
      stop();
      expect(marks).toEqual([['kept.txt'], undefined]);
    }),
  );
  it.effect('a directory mark refreshes ownership of its ignored descendants', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* written(world, '.gitignore', '*.log\n');
      yield* world.files.makeDirectory(world.paths.join(world.root, 'nested'));
      yield* written(world, 'nested/held.log', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'nested/held.log'), '', GROWN);
      const before = (yield* world.holdings.judged(world.rootId, ['nested/held.log'])).get('nested/held.log')?.holding;
      expect(before?.git).toBe('ignored');
      expect(proven(before).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
      yield* world.files.remove(world.paths.join(world.root, 'nested'), { recursive: true });
      yield* world.holdings.marked(world.rootId, ['nested']);
      yield* world.holdings.settled(world.rootId);
      const after = (yield* world.holdings.read(world.rootId)).paths.find((one) => one.path === 'nested/held.log');
      expect(proven(after).hands).toEqual([]);
      expect((yield* world.holdings.threads([MINE])).get(MINE)?.outside).toBe(0);
    }),
  );
  it.effect('a request admitted during a fold waits for inputs read after that request', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* written(world, 'kept.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      const blocked = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      let pause = true;
      const folder: Folder = Effect.fnUntraced(function* (input, cached, alignment, lane) {
        if (pause) {
          pause = false;
          yield* Deferred.succeed(blocked, undefined);
          yield* Deferred.await(released);
        }
        return yield* foldInline(input, cached, alignment, lane);
      });
      const judges = yield* judgesOf(world, world.git, folder);
      const first = yield* Effect.forkChild(judges.judged(world.rootId, ['kept.txt']));
      yield* Deferred.await(blocked);
      yield* written(world, 'kept.txt', `${GROWN}later\n`);
      const latest = yield* Effect.forkChild(judges.judged(world.rootId, ['kept.txt']));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(released, undefined);
      yield* Fiber.join(first);
      const holding = (yield* Fiber.join(latest)).get('kept.txt')?.holding;
      expect(holding?.lines).toEqual({ added: 2, removed: 0 });
      expect(proven(holding).nobody).toMatchObject([{ added: 1, removed: 0, why: { kind: 'external' } }]);
    }),
  );
  it.effect('a request does not wait for a paused background fold and is answered from inputs read after it', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* written(world, 'kept.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
      yield* written(world, 'side.txt', GROWN);
      yield* edited(world.mine, world.paths.join(world.root, 'side.txt'), '', GROWN);
      const paused = yield* Deferred.make<void>();
      const resumed = yield* Deferred.make<void>();
      const folder: Folder = Effect.fnUntraced(function* (input, cached, alignment, lane) {
        if (lane === 'later') {
          yield* Deferred.succeed(paused, undefined);
          yield* Deferred.await(resumed);
        }
        return yield* foldInline(input, cached, alignment, lane);
      });
      const judges = yield* judgesOf(world, world.git, folder);
      yield* judges.hold(world.rootId);
      yield* Deferred.await(paused);
      yield* written(world, 'kept.txt', `${GROWN}later\n`);
      const holding = (yield* judges.judged(world.rootId, ['kept.txt'])).get('kept.txt')?.holding;
      expect(holding?.lines).toEqual({ added: 2, removed: 0 });
      expect(proven(holding).nobody).toMatchObject([{ added: 1, removed: 0, why: { kind: 'external' } }]);
      yield* Deferred.succeed(resumed, undefined);
      yield* judges.settled(world.rootId);
      const side = (yield* judges.read(world.rootId)).paths.find((one) => one.path === 'side.txt');
      expect(proven(side).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
    }),
  );
  it.effect('an unstaged rename stands as the new path linked to the old one', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const from = world.paths.join(world.root, 'kept.txt');
      const to = world.paths.join(world.root, 'moved.txt');
      yield* world.files.rename(from, to);
      yield* Effect.map(
        world.mine.land(
          [
            { origin: 'delete', path: from, at: new Date(yield* Clock.currentTimeMillis), before: contentDigest(BORN), beforeText: BORN },
            {
              origin: 'write',
              path: to,
              at: new Date(yield* Clock.currentTimeMillis),
              after: contentDigest(BORN),
              afterText: BORN,
              movedFrom: from,
              mode: '100644',
            },
          ],
          Effect.succeed(true),
        ),
        () => undefined,
      );
      const judges = yield* judgesOf(world);
      const judged = yield* judges.judged(world.rootId, ['kept.txt', 'moved.txt']);
      expect(judged.get('moved.txt')?.holding).toMatchObject({ from: 'kept.txt', git: 'untracked' });
      expect(proven(judged.get('moved.txt')?.holding).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
      expect(proven(judged.get('kept.txt')?.holding).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
    }),
  );
  it.effect('a rename that changes only the case of a name leaves the old spelling deleted by its writer', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const from = world.paths.join(world.root, 'kept.txt');
      const to = world.paths.join(world.root, 'Kept.txt');
      yield* world.files.remove(from);
      yield* record(world.mine, {
        origin: 'delete',
        path: from,
        at: new Date(yield* Clock.currentTimeMillis),
        before: contentDigest(BORN),
        beforeText: BORN,
      });
      yield* written(world, 'Kept.txt', BORN);
      yield* record(world.mine, {
        origin: 'write',
        path: to,
        at: new Date(yield* Clock.currentTimeMillis),
        after: contentDigest(BORN),
        afterText: BORN,
        mode: '100644',
      });
      const judges = yield* judgesOf(world);
      const judged = yield* judges.judged(world.rootId, ['kept.txt', 'Kept.txt']);
      const old = proven(judged.get('kept.txt')?.holding);
      expect(old.hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
      expect(old.nobody).toEqual([]);
      expect(proven(judged.get('Kept.txt')?.holding).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
    }),
  );
  it.effect('one unreadable path is unknown with its reason and the others are judged as before', () =>
    silenced(
      Effect.gen(function* () {
        const world = yield* fixture;
        yield* written(world, 'other.txt', 'other\n');
        yield* run(world.git, world.root, ['add', 'other.txt']);
        yield* run(world.git, world.root, ['commit', '-q', '-m', 'other']);
        const damaged = yield* blobOf(world, 'other.txt');
        yield* written(world, 'kept.txt', GROWN);
        yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
        yield* written(world, 'other.txt', 'other\nmore\n');
        yield* edited(world.mine, world.paths.join(world.root, 'other.txt'), 'other\n', 'other\nmore\n');
        const judges = yield* judgesOf(
          world,
          poisoned(world.git, (oid) => oid === damaged),
        );
        const view = yield* Effect.andThen(judges.judged(world.rootId, ['kept.txt', 'other.txt']), judges.read(world.rootId));
        expect(view.paths.map((one) => one.path).sort()).toEqual(['kept.txt', 'other.txt']);
        const other = view.paths.find((one) => one.path === 'other.txt');
        expect(other?.verdict).toMatchObject({
          verdict: 'unknown',
          reason: { kind: 'unread', side: 'head' },
          writers: [{ kind: 'thread', thread: MINE }],
        });
        expect(proven(view.paths.find((one) => one.path === 'kept.txt')).hands.map((hand) => holderKey(hand.holder))).toEqual([MINE]);
        expect(yield* judges.threads([MINE])).toEqual(new Map([[MINE, { paths: 1, unproven: 1, outside: 0 }]]));
      }),
    ),
  );
  it.effect('a batch whose texts cannot be read leaves every path of it unknown with one reason', () =>
    silenced(
      Effect.gen(function* () {
        const world = yield* fixture;
        yield* written(world, 'other.txt', 'other\n');
        yield* run(world.git, world.root, ['add', 'other.txt']);
        yield* run(world.git, world.root, ['commit', '-q', '-m', 'other']);
        yield* written(world, 'kept.txt', GROWN);
        yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
        yield* written(world, 'other.txt', 'other\nmore\n');
        yield* edited(world.mine, world.paths.join(world.root, 'other.txt'), 'other\n', 'other\nmore\n');
        const judges = yield* judgesOf(
          world,
          poisoned(world.git, () => true),
        );
        const judged = yield* judges.judged(world.rootId, ['kept.txt', 'other.txt']);
        const reasons = [...judged.values()].map((one) => one.holding.verdict);
        expect(reasons).toHaveLength(2);
        for (const verdict of reasons) expect(verdict).toMatchObject({ verdict: 'unknown', reason: { kind: 'unread', side: 'head' } });
        expect(new Set(reasons.map((verdict) => JSON.stringify(verdict.verdict === 'unknown' ? verdict.reason : null))).size).toBe(1);
      }),
    ),
  );
  it.effect('a path carrying a carriage return stays unproven while its line-ending rules cannot be read', () =>
    silenced(
      Effect.gen(function* () {
        const world = yield* fixture;
        yield* written(world, 'crlf.txt', 'a\r\n');
        yield* edited(world.mine, world.paths.join(world.root, 'crlf.txt'), '', 'a\n');
        const git: Git['Service'] = {
          run: (args, options) =>
            args.includes('check-attr')
              ? Effect.fail(new GitEndingUnreadable({ command: [...args], reason: 'attributes are unreadable' }))
              : world.git.run(args, options),
          objects: world.git.objects!,
        };
        const judges = yield* judgesOf(world, git);
        const holding = (yield* judges.judged(world.rootId, ['crlf.txt'])).get('crlf.txt')?.holding;
        expect(holding?.verdict.verdict).toBe('unknown');
      }),
    ),
  );
  it.effect('an unread git status leaves the last list standing as stale', () =>
    silenced(
      Effect.gen(function* () {
        const world = yield* fixture;
        yield* written(world, 'kept.txt', GROWN);
        yield* edited(world.mine, world.paths.join(world.root, 'kept.txt'), BORN, GROWN);
        let broken = false;
        const git: Git['Service'] = {
          run: (args, options) =>
            broken && args.includes('status')
              ? Effect.fail(new GitEndingUnreadable({ command: [...args], reason: 'status crashed' }))
              : world.git.run(args, options),
          objects: world.git.objects!,
        };
        const judges = yield* judgesOf(world, git);
        yield* judges.judged(world.rootId, ['kept.txt']);
        yield* judges.threads([MINE]);
        expect((yield* judges.read(world.rootId)).state).toEqual({ kind: 'current' });
        broken = true;
        yield* written(world, 'kept.txt', `${GROWN}three\n`);
        yield* judges.judged(world.rootId, ['kept.txt']);
        const view = yield* judges.read(world.rootId);
        expect(view.state.kind).toBe('stale');
        expect(view.paths.map((one) => one.path)).toEqual(['kept.txt']);
      }),
    ),
  );
});
