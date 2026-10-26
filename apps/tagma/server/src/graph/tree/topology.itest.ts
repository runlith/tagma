import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { twinWorld, twinWorldLayer } from '../testing/twins.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerText } from './marker.js';
import { shippedSteps } from '../steps/sequence.js';

layer(twinWorldLayer, { excludeTestServices: true })('topology mirror', (it) => {
  it.effect('an unborn code repository stands on its named branch without absorbing anything', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, sync, sh } = yield* twinWorld();
      const project = join(base, 'unborn');
      yield* fs.makeDirectory(project);
      yield* sh(['init', '-b', 'main', project]);
      expect(yield* sync(project)).toMatchObject({ branch: 'main', forkedFrom: null, merges: [] });
    }),
  );

  it.effect('forks the graph, absorbs the delivered branch at the earlier format step, then prunes its retired twin', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, write, commit, sh } = yield* twinWorld();
      const tree = treeOf(project);
      expect((yield* sync(project)).branch).toBe('main');
      yield* fs.writeFileString(join(tree, FORMAT_FILE), markerText(null));
      yield* write(project, 'doctrine', 'the standing law');
      yield* sh(['switch', '-c', 'feature'], project);
      expect(yield* sync(project)).toMatchObject({ branch: 'feature', forkedFrom: 'main' });
      const feature = yield* write(project, 'feature-rule', 'binds only this branch');
      yield* commit(project, 'feature');
      yield* sh(['switch', 'main'], project);
      expect((yield* sync(project)).branch).toBe('main');
      expect(yield* fs.exists(join(tree, 'feature-rule.md'))).toBe(false);
      yield* fs.writeFileString(join(tree, FORMAT_FILE), markerText(shippedSteps.last));
      yield* shadow.commitAct(tree, 'graph steps');
      yield* sh(['merge', '--no-ff', 'feature', '-m', 'merge feature'], project);
      const merged = yield* sync(project);
      expect(merged.merges.map((merge) => [merge.branch, merge.conflicts])).toEqual([['feature', []]]);
      expect(yield* fs.readFileString(join(tree, 'feature-rule.md'))).toBe(feature);
      expect(yield* fs.readFileString(join(tree, FORMAT_FILE))).toBe(markerText(null));
      yield* sh(['branch', '-d', 'feature'], project);
      expect((yield* sync(project)).pruned).toEqual(['feature']);
    }),
  );

  it.effect('a conflicting absorption reports its path while keeping the served HEAD and bytes out of the merge', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, write, commit, sh } = yield* twinWorld();
      const tree = treeOf(project);
      yield* sync(project);
      yield* write(project, 'shared', 'the law');
      yield* sh(['switch', '-c', 'feature'], project);
      yield* sync(project);
      yield* write(project, 'shared', 'the law as the feature reads it');
      yield* commit(project, 'feature');
      yield* sh(['switch', 'main'], project);
      yield* sync(project);
      const standing = yield* write(project, 'shared', 'the law as main reads it');
      const head = yield* sh(['rev-parse', 'HEAD'], tree);
      const merged = yield* sh(['commit-tree', 'feature^{tree}', '-p', 'main', '-p', 'feature', '-m', 'merge feature'], project);
      yield* sh(['read-tree', '-u', '-m', 'HEAD', 'feature'], project);
      yield* sh(['update-ref', 'refs/heads/main', merged], project);
      expect((yield* sync(project)).merges.map((merge) => [merge.branch, merge.merged, merge.conflicts])).toEqual([
        ['feature', null, ['shared.md']],
      ]);
      expect(yield* shadow.unmergedPaths(tree)).toEqual([]);
      expect(yield* shadow.mergeInProgress(tree)).toBe(false);
      expect(yield* sh(['rev-parse', 'HEAD'], tree)).toBe(head);
      expect(yield* fs.readFileString(join(tree, 'shared.md'))).toBe(standing);
    }),
  );

  it.effect('a graph-only branch is not absorbed at its code fork point and remains stranded after its branch is dropped', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, write, commit, sh } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'doctrine', 'the law');
      yield* sh(['switch', '-c', 'notes'], project);
      yield* sync(project);
      const note = yield* write(project, 'private-note', 'never delivered');
      yield* sh(['switch', 'main'], project);
      yield* commit(project, 'later');
      expect((yield* sync(project)).merges).toEqual([]);
      expect(yield* fs.exists(join(treeOf(project), 'private-note.md'))).toBe(false);
      yield* sh(['branch', '-D', 'notes'], project);
      const retired = yield* sync(project);
      expect(retired.pruned).toEqual([]);
      expect(retired.stranded.map((entry) => entry.branch)).toEqual(['notes']);
      expect(yield* shadow.run('test', ['--git-dir', shadow.gitDir, 'show', 'notes:private-note.md'])).toBe(note.trim());
    }),
  );

  it.effect('a detached code checkout refuses before changing its graph branch, HEAD or files', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, treeOf, sync, write, sh } = yield* twinWorld();
      yield* sync(project);
      const text = yield* write(project, 'doctrine', 'the law');
      const tree = treeOf(project);
      const before = yield* sh(['rev-parse', 'HEAD'], tree);
      yield* sh(['switch', '--detach'], project);
      const failure = yield* Effect.flip(sync(project));
      expect([failure._tag, failure.op, failure.ran]).toEqual(['OwnGitFailed', 'topology', true]);
      expect(yield* sh(['rev-parse', '--abbrev-ref', 'HEAD'], tree)).toBe('main');
      expect(yield* sh(['rev-parse', 'HEAD'], tree)).toBe(before);
      expect(yield* fs.readFileString(join(tree, 'doctrine.md'))).toBe(text);
    }),
  );

  it.effect('a second code worktree owns an isolated graph, then hands its twin to the checkout that takes its branch', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, treeOf, sync, checkout, write, sh } = yield* twinWorld();
      yield* sync(project);
      const doctrine = yield* write(project, 'doctrine', 'the standing law');
      const release = yield* checkout('release', 'main');
      expect(yield* sync(release)).toMatchObject({ branch: 'release', forkedFrom: 'main' });
      expect(yield* fs.readFileString(join(treeOf(release), 'doctrine.md'))).toBe(doctrine);
      const note = yield* write(release, 'release-note', 'written on release');
      expect(yield* fs.exists(join(treeOf(project), 'release-note.md'))).toBe(false);
      yield* sh(['switch', '--detach'], release);
      yield* sh(['switch', 'release'], project);
      expect((yield* sync(project)).branch).toBe('release');
      expect(yield* fs.readFileString(join(treeOf(project), 'release-note.md'))).toBe(note);
      expect(yield* sh(['rev-parse', '--abbrev-ref', 'HEAD'], treeOf(release))).toBe('HEAD');
    }),
  );

  it.effect('another clone keeps its graph twin when the original checkout tries to take the same branch', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, project, treeOf, sync, write, sh } = yield* twinWorld();
      yield* sync(project);
      yield* sh(['branch', 'release'], project);
      const clone = join(base, 'clone');
      yield* sh(['clone', '-q', '-b', 'release', project, clone]);
      yield* sync(clone);
      const note = yield* write(clone, 'release-note', 'knowledge in the clone');
      const head = yield* sh(['rev-parse', 'HEAD'], treeOf(clone));
      yield* sh(['switch', 'release'], project);
      const failure = yield* Effect.flip(sync(project));
      expect([failure._tag, failure.op]).toEqual(['OwnGitFailed', 'switch']);
      expect(yield* sh(['rev-parse', '--abbrev-ref', 'HEAD'], treeOf(clone))).toBe('release');
      expect(yield* sh(['rev-parse', 'HEAD'], treeOf(clone))).toBe(head);
      expect(yield* fs.readFileString(join(treeOf(clone), 'release-note.md'))).toBe(note);
    }),
  );
});
