import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer, Schema } from 'effect';
import { join } from 'node:path';
import { PathAuthorship } from '../../../change-record/contract/wire/authorship.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { CheckoutRows } from '../../../workspace/contract/service/checkouts.js';
import { CheckoutState } from '../../../workspace/contract/wire/checkout.js';
import { DoorFixture, doorFixture, projectLeaving } from '../doorFixture.js';
import { suiteGit, suiteGitRan } from '../suiteGit.js';

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
      yield* suiteGit(root, '--literal-pathspecs', 'init', '-q', '-b', 'main');
      const path = ':(literal)é engine';
      const nested = join(root, path);
      yield* suiteGit(root, '--literal-pathspecs', '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, path);
      yield* suiteGit(nested, 'checkout', '-q', first);
      yield* suiteGit(root, '--literal-pathspecs', 'add', '.');
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
      yield* suiteGit(root, '--literal-pathspecs', 'commit', '-qm', 'pin first');
      const base = (yield* suiteGit(root, '--literal-pathspecs', 'rev-parse', 'HEAD')).trim();
      yield* suiteGit(nested, 'checkout', '-q', staged);
      yield* suiteGit(root, '--literal-pathspecs', 'add', '--', path);
      yield* suiteGit(nested, 'checkout', '-q', working);
      yield* files.writeFileString(join(nested, 'value.txt'), 'local edit\n');
      yield* files.writeFileString(join(nested, 'untracked.txt'), 'new\n');
      const index = yield* read({ side: 'staged' });
      expect(index.submodule).toEqual({ before: pin(first), after: pin(staged) });
      expect(index.lines).toEqual([]);
      yield* suiteGit(root, '--literal-pathspecs', 'config', `submodule.${path}.ignore`, 'dirty');
      const whole = yield* read({});
      expect(whole.submodule).toEqual({
        before: pin(first),
        after: pin(working),
        working: { state: 'ready', trackedChanges: true, untrackedChanges: true },
      });
      const unstaged = yield* read({ side: 'unstaged' });
      expect(unstaged.submodule).toEqual({ ...whole.submodule, before: pin(staged), after: pin(working) });
      const rows = Context.get(world.runtime.workspace, CheckoutRows);
      yield* rows.follow(rootId);
      const checkout = Effect.fnUntraced(function* () {
        const reply = yield* world.op('read_checkout', { root: rootId }, `project=${project}`);
        if (reply.status !== 200) return yield* Effect.die(new Error(JSON.stringify(reply.body)));
        return (yield* Schema.decodeUnknownEffect(Schema.Struct({ checkout: CheckoutState }))(reply.body)).checkout;
      });
      const beforeStage = (yield* checkout()).entries.staged.entries.find((entry) => entry.path === path)!;
      expect((yield* world.op('stage_checkout', { rootId, paths: [path] }, `project=${project}`)).status).toBe(200);
      yield* rows.refresh(rootId);
      const afterStage = (yield* checkout()).entries.staged.entries.find((entry) => entry.path === path)!;
      expect(afterStage.lines).toEqual(beforeStage.lines);
      expect(afterStage.mark).not.toBe(beforeStage.mark);
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: pin(first), after: pin(working) });
      yield* suiteGit(root, '--literal-pathspecs', 'update-index', '--cacheinfo', `160000,${staged},${path}`);
      yield* suiteGit(root, '--literal-pathspecs', 'commit', '-qm', 'pin second');
      const head = (yield* suiteGit(root, '--literal-pathspecs', 'rev-parse', 'HEAD')).trim();
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
      for (const target of [source, join(root, 'missing-target')]) {
        yield* files.symlink(target, nested);
        expect((yield* read({})).submodule).toEqual({ before: pin(staged), after: { kind: 'file' } });
        yield* files.remove(nested);
      }
      yield* suiteGit(root, '--literal-pathspecs', 'submodule', 'update', '--init', '--', path);
      yield* suiteGit(root, '--literal-pathspecs', 'submodule', 'deinit', '-f', '--', path);
      expect((yield* read({})).submodule).toEqual({
        before: pin(staged),
        after: pin(staged),
        working: { state: 'uninitialized', trackedChanges: false, untrackedChanges: false },
      });
      yield* suiteGit(root, '--literal-pathspecs', 'rm', '-q', '--cached', '--', path);
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: pin(staged), after: { kind: 'absent' } });
      yield* suiteGit(root, '--literal-pathspecs', 'commit', '-qm', 'remove pin');
      yield* suiteGit(root, '--literal-pathspecs', 'update-index', '--add', '--cacheinfo', `160000,${working},${path}`);
      expect((yield* read({ side: 'staged' })).submodule).toEqual({ before: { kind: 'absent' }, after: pin(working) });
    }),
  );

  it.effect('a whole working diff reads a modify/delete conflict without requiring a resolved index', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('conflict'));
      const path = 'conflict.txt';
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, path), 'base\n');
      yield* suiteGit(root, 'add', '.');
      yield* suiteGit(root, 'commit', '-qm', 'base');
      yield* suiteGit(root, 'checkout', '-qb', 'other');
      yield* files.writeFileString(join(root, path), 'base\nother\n');
      yield* suiteGit(root, 'commit', '-qam', 'modify');
      yield* suiteGit(root, 'checkout', '-q', 'main');
      yield* suiteGit(root, 'rm', '-q', path);
      yield* suiteGit(root, 'commit', '-qm', 'delete');
      expect((yield* suiteGitRan(root, 'merge', 'other')).exitCode).toBe(1);
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const rootId = coverage.roots.find((row) => row.path === root)!.rootId;
      const reply = yield* world.op('read_authorship', { rootId, path }, `project=${project}`);
      if (reply.status !== 200) return yield* Effect.die(new Error(JSON.stringify(reply.body)));
      const { authorship } = yield* Schema.decodeUnknownEffect(Schema.Struct({ authorship: PathAuthorship }))(reply.body);
      expect(
        authorship.lines
          .filter((line) => line.kind === 'added')
          .map((line) => line.text)
          .join('\n'),
      ).toBe('base\nother\n');
    }),
  );

  it.effect('a repository with no commit yet reads a new file as wholly added, whole and as its unstaged half', () =>
    Effect.gen(function* () {
      const world = yield* DoorFixture;
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.realPath(yield* world.directory('unborn'));
      const path = 'package.json';
      yield* suiteGit(root, 'init', '-q', '-b', 'main');
      yield* files.writeFileString(join(root, path), '{}\n');
      const project = yield* world.stealthProject(root);
      yield* projectLeaving(world, project);
      const coverage = yield* Context.get(world.runtime.workspace, Coverage).cover(project);
      const rootId = coverage.roots.find((row) => row.path === root)!.rootId;
      for (const input of [{}, { side: 'unstaged' }]) {
        const reply = yield* world.op('read_authorship', { rootId, path, ...input }, `project=${project}`);
        if (reply.status !== 200) return yield* Effect.die(new Error(JSON.stringify(reply.body)));
        const { authorship } = yield* Schema.decodeUnknownEffect(Schema.Struct({ authorship: PathAuthorship }))(reply.body);
        expect(authorship.lines.every((line) => line.kind === 'added')).toBe(true);
        expect(authorship.lines.map((line) => line.text).join('\n')).toBe('{}\n');
      }
    }),
  );
});
