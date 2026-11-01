import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { join } from 'node:path';
import { PathAuthorship } from '../../../change-record/contract/wire/authorship.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit } from '../suiteGit.js';

layer(doorFixture().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('submodule diff', (it) => {
  it.effect('the app reads submodule pins independently of the nested working tree, including history and an uninitialized checkout', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const source = yield* world.directory('library');
      yield* suiteGit(source, 'init', '-q', '-b', 'main');
      const pins: string[] = [];
      for (const value of ['one', 'two', 'three']) {
        yield* files.writeFileString(join(source, 'value.txt'), `${value}\n`);
        yield* suiteGit(source, 'add', 'value.txt');
        yield* suiteGit(source, 'commit', '-qm', value);
        pins.push((yield* suiteGit(source, 'rev-parse', 'HEAD')).trim());
      }
      const [first, staged, working] = pins as [string, string, string];
      const root = yield* files.realPath(yield* world.directory('parent'));
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      const path = 'libs/é engine';
      const nested = join(root, path);
      yield* suiteGit(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, path);
      yield* suiteGit(nested, 'checkout', '-q', first);
      yield* suiteGit(root, 'add', '.');
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const rootId = coverage.roots.find((row) => row.path === root)!.rootId;
      const read = Effect.fnUntraced(function* (input: Record<string, unknown>) {
        const reply = yield* world.op('read_authorship', { rootId, path, ...input }, `project=${project}`);
        if (reply.status !== 200) return yield* Effect.die(new Error(JSON.stringify(reply.body)));
        return (yield* Schema.decodeUnknownEffect(Schema.Struct({ authorship: PathAuthorship }))(reply.body)).authorship;
      });
      const pin = (oid: string) => ({ kind: 'commit' as const, oid });
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: { kind: 'absent' }, after: pin(first) });
      yield* suiteGit(root, 'commit', '-qm', 'pin first');
      const base = (yield* suiteGit(root, 'rev-parse', 'HEAD')).trim();
      yield* suiteGit(nested, 'checkout', '-q', staged);
      yield* suiteGit(root, 'add', '--', path);
      yield* suiteGit(nested, 'checkout', '-q', working);
      yield* files.writeFileString(join(nested, 'value.txt'), 'local edit\n');
      yield* files.writeFileString(join(nested, 'untracked.txt'), 'new\n');
      const index = yield* read({ side: 'staged' });
      expect(index.submodule).toEqual({ before: pin(first), after: pin(staged) });
      expect(index.lines).toEqual([]);
      const whole = yield* read({});
      expect(whole.submodule).toEqual({
        before: pin(first),
        after: pin(working),
        working: { state: 'ready', trackedChanges: true, untrackedChanges: true },
      });
      const unstaged = yield* read({ side: 'unstaged' });
      expect(unstaged.submodule).toEqual({ ...whole.submodule, before: pin(staged), after: pin(working) });
      yield* suiteGit(root, 'commit', '-qm', 'pin second');
      const head = (yield* suiteGit(root, 'rev-parse', 'HEAD')).trim();
      expect((yield* read({ commit: head })).submodule).toEqual(index.submodule);
      expect((yield* read({ commit: head, base })).submodule).toEqual(index.submodule);
      yield* suiteGit(nested, 'reset', '--hard', staged);
      expect((yield* read({})).submodule).toEqual({
        before: pin(staged),
        after: pin(staged),
        working: { state: 'ready', trackedChanges: false, untrackedChanges: true },
      });
      yield* files.remove(nested, { recursive: true });
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: pin(staged), after: pin(staged) });
      expect((yield* read({})).submodule).toEqual({
        before: pin(staged),
        after: { kind: 'absent' },
        working: { state: 'missing', trackedChanges: false, untrackedChanges: false },
      });
      yield* suiteGit(root, 'submodule', 'update', '--init', '--', path);
      yield* suiteGit(root, 'submodule', 'deinit', '-f', '--', path);
      expect((yield* read({})).submodule).toEqual({
        before: pin(staged),
        after: pin(staged),
        working: { state: 'uninitialized', trackedChanges: false, untrackedChanges: false },
      });
      yield* suiteGit(root, 'rm', '-q', '--cached', '--', path);
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: pin(staged), after: { kind: 'absent' } });
      yield* suiteGit(root, 'commit', '-qm', 'remove pin');
      yield* suiteGit(root, 'update-index', '--add', '--cacheinfo', `160000,${working},${path}`);
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: { kind: 'absent' }, after: pin(working) });
    }),
  );
});
