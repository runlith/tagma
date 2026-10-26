import { expect, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { layer } from '@runlith/effect-test';
import { Clock, Effect, FileSystem } from 'effect';
import { Git, GitEndingUnreadable, gitVerb } from '@runlith/git/Git';
import type { Folder } from '../../../change-record/holdings/judge.js';
import { makeJudges } from '../../../change-record/holdings/judges.js';
import { makeGitMetadata } from '../../../change-record/record/metadata.js';
import { FoldMemory } from '../../../change-record/lines/memory.js';
import { foldInline } from '../../../change-record/testing/holdings.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { CheckoutRows, GraphDirectory } from '../../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../../workspace/contract/service/roots.js';
import { fixture, layers, edited, run, GROWN, BORN, MINE } from './threadFilesWorld.js';

const judgesOf = (world: Effect.Success<typeof fixture>, git: Git['Service'] = world.git, folder: Folder = foldInline) =>
  Effect.flatMap(makeGitMetadata, (metadata) => makeJudges({ folder, walks: world.walks, memory: new FoldMemory(1 << 26), metadata })).pipe(
    Effect.provideService(MachineStore, world.store),
    Effect.provideService(MachineUnits, world.units),
    Effect.provideService(Git, git),
    Effect.provideService(FileSystem.FileSystem, world.files),
    Effect.provideService(FileRoots, world.roots),
    Effect.provideService(CheckoutRows, world.checkouts),
    Effect.provideService(GraphDirectory, '.tagma'),
  );

layer(layers, { excludeTestServices: true })('ignored observer inputs', (it) => {
  it.effect('a recorded tracked path adds no ignore-policy process to its ordinary judgement', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const held = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(held, GROWN);
      yield* edited(world.mine, held, BORN, GROWN);
      yield* world.holdings.settled(world.rootId);
      const calls: string[] = [];
      const git: Git['Service'] = {
        objects: world.git.objects,
        run: (args, options) => {
          calls.push(gitVerb(args));
          return world.git.run(args, options);
        },
      };
      const judges = yield* judgesOf(world, git);
      yield* judges.follow(world.rootId);
      yield* judges.judged(world.rootId, ['kept.txt']);
      yield* judges.settled(world.rootId);
      calls.length = 0;
      const answer = yield* judges.judged(world.rootId, ['kept.txt']);
      console.info({ ordinaryGitSpawns: calls.length, ordinaryIgnoreSpawns: calls.filter((verb) => verb === 'check-ignore').length });
      expect(calls).not.toContain('check-ignore');
      expect(answer.get('kept.txt')?.holding.verdict).toMatchObject({
        verdict: 'proven',
        hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }],
      });
    }),
  );

  it.effect('an unread ignore policy leaves outside ownership present and reports stale until it can be read', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const held = world.paths.join(world.root, 'trace.log');
      yield* world.files.writeFileString(world.paths.join(world.root, '.gitignore'), '*.log\n');
      yield* world.files.writeFileString(held, GROWN);
      yield* edited(world.mine, held, '', GROWN);
      let unavailable = false;
      const git: Git['Service'] = {
        objects: world.git.objects,
        run: (args, options) =>
          unavailable && args.includes('check-ignore')
            ? Effect.fail(new GitEndingUnreadable({ command: [...args], reason: 'ignore policy is unavailable' }))
            : world.git.run(args, options),
      };
      const judges = yield* judgesOf(world, git);
      yield* judges.follow(world.rootId);
      yield* judges.judged(world.rootId, ['trace.log']);
      unavailable = true;
      const failed = yield* judges.judged(world.rootId, ['trace.log']);
      expect((yield* judges.read(world.rootId)).state.kind).toBe('stale');
      expect(failed.get('trace.log')?.holding).toMatchObject({
        git: 'ignored',
        verdict: { verdict: 'proven', hands: [{ holder: { kind: 'thread', thread: MINE }, added: 2, removed: 0 }] },
      });
      unavailable = false;
      yield* judges.judged(world.rootId, ['trace.log']);
      yield* judges.settled(world.rootId);
      expect((yield* judges.read(world.rootId)).state.kind).toBe('current');
      expect((yield* judges.threads([MINE])).get(MINE)?.outside).toBe(1);
    }),
  );
  it.effect('ignored spellings preserve tracked deletions and staged rename sources', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      yield* world.files.writeFileString(world.paths.join(world.root, '.gitignore'), '*.log\n');
      yield* world.files.writeFileString(world.paths.join(world.root, 'tracked.log'), GROWN);
      yield* run(world.git, world.root, ['add', '-f', 'tracked.log']);
      yield* run(world.git, world.root, ['commit', '-q', '-m', 'Track the log']);
      yield* run(world.git, world.root, ['rm', '--cached', 'tracked.log']);
      const answer = yield* world.holdings.judged(world.rootId, ['tracked.log']);
      expect(answer.get('tracked.log')?.holding.git).toBe('deleted');
      yield* run(world.git, world.root, ['add', '-f', 'tracked.log']);
      yield* run(world.git, world.root, ['mv', 'tracked.log', 'renamed.txt']);
      const renamed = yield* world.holdings.judged(world.rootId, ['tracked.log', 'renamed.txt']);
      expect(renamed.has('tracked.log')).toBe(true);
      expect(renamed.get('tracked.log')?.holding.git).not.toBe('ignored');
      expect(renamed.get('renamed.txt')?.holding).toMatchObject({ git: 'renamed', from: 'tracked.log' });
    }),
  );

  it.effect('an ignored directory is excluded before disk reads and folding, while recorded descendants still stand outside git', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const directory = world.paths.join(world.root, 'cache/generated');
      const held = world.paths.join(world.root, 'cache/held.log');
      yield* world.files.writeFileString(world.paths.join(world.root, '.gitignore'), 'cache/\n');
      yield* world.files.makeDirectory(directory, { recursive: true });
      yield* world.files.writeFileString(held, GROWN);
      yield* edited(world.mine, held, '', GROWN);
      yield* world.holdings.settled(world.rootId);
      yield* world.checkouts.follow(world.rootId);
      const folded: string[] = [];
      const judges = yield* judgesOf(world, world.git, (input, cached, alignment, lane) => {
        folded.push(input.working.kind);
        return foldInline(input, cached, alignment, lane);
      });
      yield* Effect.acquireRelease(
        Effect.sync(() => world.checkouts.onMark((root, paths) => judges.marked(root, paths))),
        (stop) => Effect.sync(stop),
      );
      const stat = yield* Effect.acquireRelease(
        Effect.sync(() => spyOn(fs, 'lstat')),
        (spied) => Effect.sync(() => spied.mockRestore()),
      );
      const start = yield* Clock.currentTimeMillis;
      const answer = yield* judges.judged(world.rootId, ['cache/generated', 'cache/held.log']);
      const queryMs = (yield* Clock.currentTimeMillis) - start;
      const ignoredReads = stat.mock.calls.filter(([path]) => String(path) === directory).length;
      const heldReads = stat.mock.calls.filter(([path]) => String(path) === held).length;
      const ignoredFolds = folded.filter((kind) => kind === 'unread').length;
      stat.mockClear();
      folded.length = 0;
      yield* world.files.writeFileString(held, BORN);
      const marked = yield* Clock.currentTimeMillis;
      yield* world.checkouts.mark(world.rootId, 'observer', ['cache/generated', 'cache']);
      yield* judges.settled(world.rootId);
      yield* world.holdings.settled(world.rootId);
      const markMs = (yield* Clock.currentTimeMillis) - marked;
      const markedIgnoredReads = stat.mock.calls.filter(([path]) => String(path) === directory).length;
      const after = (yield* judges.read(world.rootId)).paths.find((one) => one.path === 'cache/held.log');
      console.info({ queryMs, markMs, ignoredReads, markedIgnoredReads, ignoredFolds, folds: folded.length });
      expect(answer.has('cache/generated')).toBe(false);
      expect(ignoredReads).toBe(0);
      expect(markedIgnoredReads).toBe(0);
      expect(ignoredFolds).toBe(0);
      expect(folded).not.toContain('unread');
      expect(heldReads).toBeGreaterThan(0);
      expect(answer.get('cache/held.log')?.holding.git).toBe('ignored');
      expect(after?.git).toBe('ignored');
      expect(after?.verdict).toMatchObject({
        verdict: 'proven',
        hands: [{ holder: { kind: 'thread', thread: MINE }, added: 1, removed: 0 }],
      });
      expect((yield* judges.threads([MINE])).get(MINE)?.outside).toBe(1);
    }),
  );
});
