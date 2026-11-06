import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { kind, shared } from '@runlith/testbed/worlds';
import { dirname, join, resolve } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ownGitLayer } from '../../platform/git/ownGit.js';
import { ShadowGit } from './shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';
import { TreeMerges } from './merges.js';

const block = (body: string, id = '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7a') => `---\nid: ${id}\ntitle: Rule\nord: 1\n---\n${body}\n`;
const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(spawning)));

class MergeTemplate extends Context.Service<MergeTemplate, { readonly gitDir: string; readonly theirs: string; readonly base: string }>()(
  'tagma/graph/MergeTemplate',
) {}

const templates = kind(MergeTemplate, (_params: null, root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const shadow = yield* ShadowGit.open(join(root, 'graph.git'), yield* Git, NO_SIDE);
    const tree = join(root, 'tree');
    yield* shadow.attach(tree, 'main');
    yield* fs.writeFileString(join(tree, 'rule.md'), block('base'));
    yield* shadow.commitAct(tree, 'base');
    yield* shadow.branch('incoming', 'main');
    const incoming = join(root, 'incoming');
    yield* shadow.attach(incoming, 'incoming');
    yield* fs.writeFileString(join(incoming, 'rule.md'), block('incoming knowledge'));
    const theirs = yield* shadow.commitAct(incoming, 'incoming');
    yield* fs.writeFileString(join(tree, 'rule.md'), block('current knowledge'));
    const base = yield* shadow.commitAct(tree, 'current');
    if (theirs === null || base === null) return yield* Effect.fail('fixture commits missing');
    yield* shadow.retire(incoming);
    yield* shadow.retire(tree);
    return MergeTemplate.of({ gitDir: shadow.gitDir, theirs, base });
  }).pipe(Effect.provide(Layer.merge(platform, git))),
);
const template = Layer.effect(MergeTemplate, shared(templates, null)).pipe(Layer.provideMerge(Layer.merge(platform, git)));

const world = Effect.fn('mergesFixture.copy')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { gitDir: source, theirs, base } = yield* MergeTemplate;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'graph-merges-' });
  const gitDir = join(root, 'graph.git');
  yield* fs.copy(source, gitDir, { overwrite: true });
  const shadow = yield* ShadowGit.open(gitDir, yield* Git, NO_SIDE);
  const tree = join(root, 'tree');
  yield* shadow.attach(tree, 'main');
  return { shadow, tree, theirs, base };
});

layer(template, { excludeTestServices: true })('graph merge recovery', (it) => {
  it.effect('reopens isolated conflict, refuses unreadable or stale publication and includes both histories', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shadow, tree, theirs, base } = yield* world();
      const owner = TreeMerges.at(shadow, tree);
      expect(yield* owner.merge('incoming')).toEqual({ merged: null, conflicts: ['rule.md'] });
      expect(yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD'])).toBe(base);
      expect(yield* fs.readFileString(join(tree, 'rule.md'))).toBe(block('current knowledge'));
      expect(yield* shadow.unmergedPaths(tree)).toEqual([]);
      const reopened = TreeMerges.at(yield* ShadowGit.open(shadow.gitDir, yield* Git, NO_SIDE), tree);
      const pending = yield* reopened.read();
      expect(pending).toMatchObject({ branch: 'main', incoming: 'incoming', base, theirs, conflicts: ['rule.md'], threadId: null });
      if (pending === null) return yield* Effect.fail('missing recovery');
      expect(yield* shadow.stagedSides(pending.path, 'rule.md')).toEqual(
        new Map([
          [2, block('current knowledge')],
          [3, block('incoming knowledge')],
        ]),
      );
      expect(yield* Effect.flip(reopened.finish('tree'))).toMatchObject({ _tag: 'OwnGitFailed', op: 'graph-recovery' });
      expect(yield* reopened.read()).toEqual(pending);
      yield* fs.writeFileString(join(pending.path, 'rule.md'), block('current and incoming knowledge'));
      yield* fs.writeFileString(join(pending.path, 'format.json'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> incoming\n');
      expect(yield* Effect.flip(reopened.finish('tree'))).toMatchObject({ _tag: 'OwnGitFailed', op: 'graph-recovery' });
      yield* fs.writeFileString(join(pending.path, 'format.json'), '{}\n');
      const added = block('new target knowledge', '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7b');
      yield* fs.writeFileString(join(tree, 'new.md'), added);
      const advanced = yield* shadow.commitAct(tree, 'target advanced');
      if (advanced === null) return yield* Effect.fail('target commit missing');
      expect(yield* Effect.flip(reopened.finish('tree'))).toMatchObject({ _tag: 'OwnGitFailed', op: 'graph-recovery' });
      expect(yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD'])).toBe(advanced);
      yield* shadow.merge(pending.path, advanced, 'include the new target');
      const finished = yield* reopened.finish('tree');
      expect(yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD'])).toBe(finished.commit);
      expect(yield* shadow.run('ancestry', ['--git-dir', shadow.gitDir, 'merge-base', theirs, finished.commit])).toBe(theirs);
      expect(yield* shadow.run('ancestry', ['--git-dir', shadow.gitDir, 'merge-base', advanced, finished.commit])).toBe(advanced);
      expect(yield* fs.readFileString(join(tree, 'rule.md'))).toBe(block('current and incoming knowledge'));
      expect(yield* fs.readFileString(join(tree, 'new.md'))).toBe(added);
      expect(yield* reopened.read()).toBeNull();
    }),
  );

  it.effect('discards an attempt cut before its outcome and starts the next merge with a new recovery', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shadow, tree, theirs, base } = yield* world();
      const owner = TreeMerges.at(shadow, tree);
      const path = join(dirname(shadow.gitDir), 'recovery/cut');
      yield* shadow.run('cut-create', ['--git-dir', shadow.gitDir, 'worktree', 'add', '--detach', path, base]);
      yield* shadow.merge(path, theirs, 'merge incoming');
      yield* fs.makeDirectory(dirname(owner.file), { recursive: true });
      yield* fs.writeFileString(
        owner.file,
        JSON.stringify({
          id: 'cut',
          treeRoot: tree,
          path,
          branch: 'main',
          incoming: 'incoming',
          base,
          theirs,
          createdAt: new Date(0).toISOString(),
          conflicts: null,
          threadId: null,
          relocating: false,
          ready: null,
          published: null,
        }),
      );
      expect(yield* owner.read()).toBeNull();
      expect(yield* owner.merge('incoming')).toEqual({ merged: null, conflicts: ['rule.md'] });
      expect(yield* fs.exists(path)).toBe(false);
      const pending = yield* owner.read();
      expect(pending).toMatchObject({ branch: 'main', incoming: 'incoming', base, theirs, conflicts: ['rule.md'] });
      expect(pending?.id).not.toBe('cut');
    }),
  );

  it.effect("finishes the recovery of a team project's stealth forest, whose blocks stand under their parents' uuid directories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: 'graph-forest-' });
      const shadow = yield* ShadowGit.open(join(root, 'graph.git'), yield* Git, NO_SIDE);
      const tree = join(root, 'tree');
      const parent = '0198c3d4-7b2a-7f00-8000-3f9ac2b41e00';
      const file = join(tree, parent, 'rule.md');
      yield* shadow.attach(tree, 'main');
      yield* fs.makeDirectory(join(tree, parent), { recursive: true });
      yield* fs.writeFileString(file, block('base'));
      yield* shadow.commitAct(tree, 'base');
      yield* shadow.branch('incoming', 'main');
      const incoming = join(root, 'incoming');
      yield* shadow.attach(incoming, 'incoming');
      yield* fs.writeFileString(join(incoming, parent, 'rule.md'), block('incoming knowledge'));
      yield* shadow.commitAct(incoming, 'incoming');
      yield* shadow.retire(incoming);
      yield* fs.writeFileString(file, block('current knowledge'));
      yield* shadow.commitAct(tree, 'current');
      const owner = TreeMerges.at(shadow, tree);
      expect(yield* owner.merge('incoming')).toEqual({ merged: null, conflicts: [`${parent}/rule.md`] });
      const pending = yield* owner.read();
      if (pending === null) return yield* Effect.fail('missing recovery');
      yield* fs.writeFileString(join(pending.path, parent, 'rule.md'), block('current and incoming knowledge'));
      const finished = yield* owner.finish('forest');
      expect(finished.resolved).toEqual([`${parent}/rule.md`]);
      expect(yield* fs.readFileString(file)).toBe(block('current and incoming knowledge'));
    }),
  );

  it.effect('moves a served-tree merge with its index and edits, restores a readable branch and reopens idempotently', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shadow, tree, base, theirs } = yield* world();
      yield* shadow.merge(tree, 'incoming', 'merge incoming');
      const conflicted = yield* fs.readFileString(join(tree, 'rule.md'));
      const draft = block('saved during recovery', '0198c3d4-7b2a-7f00-8000-3f9ac2b41e7b');
      yield* fs.writeFileString(join(tree, 'draft.md'), draft);
      const owner = TreeMerges.at(shadow, tree);
      yield* owner.restore();
      const pending = yield* owner.read();
      expect(pending).toMatchObject({ branch: 'main', incoming: 'incoming', base, theirs });
      if (pending === null) return yield* Effect.fail('missing recovery');
      expect(yield* fs.readFileString(join(pending.path, 'rule.md'))).toBe(conflicted);
      expect(yield* fs.readFileString(join(pending.path, 'draft.md'))).toBe(draft);
      expect(yield* shadow.unmergedPaths(pending.path)).toEqual(['rule.md']);
      expect(yield* shadow.mergeInProgress(pending.path)).toBe(true);
      expect(yield* shadow.unmergedPaths(tree)).toEqual([]);
      expect(yield* fs.readFileString(join(tree, 'rule.md'))).toBe(block('current knowledge'));
      expect(yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD'])).toBe(base);
      yield* owner.restore();
      expect(yield* owner.read()).toEqual(pending);
    }),
  );

  it.effect('moves a served-tree merge whose message is gone and names its incoming commit', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shadow, tree, base, theirs } = yield* world();
      yield* shadow.merge(tree, 'incoming', 'merge incoming');
      yield* fs.remove(resolve(tree, yield* shadow.run('message', ['-C', tree, 'rev-parse', '--git-path', 'MERGE_MSG'])));
      const owner = TreeMerges.at(shadow, tree);
      yield* owner.restore();
      expect(yield* owner.read()).toMatchObject({ branch: 'main', incoming: theirs, base, theirs });
      expect(yield* shadow.mergeInProgress(tree)).toBe(false);
      expect(yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD'])).toBe(base);
    }),
  );
});
