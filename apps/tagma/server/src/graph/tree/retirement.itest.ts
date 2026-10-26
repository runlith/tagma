import { join } from 'node:path';
import { shippedSteps } from '../steps/sequence.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { TreeMerges } from './merges.js';
import { readTopology, rememberTopology, syncTopology, type TopologyMemory } from './topology.js';
import { twinWorld, twinWorldLayer, unheld } from '../testing/twins.js';

layer(twinWorldLayer, { excludeTestServices: true })('retiring what a departed checkout left', (it) => {
  it.effect('detects a departed checkout with a kept branch, removes clean trees and delivered twins, and preserves undelivered work', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, checkout, commit, write, sh } = yield* twinWorld();
      const release = yield* checkout('release', 'main');
      yield* commit(release, 'cut');
      const delivered = yield* checkout('delivered', 'release');
      const dirty = yield* checkout('dirty', 'main');
      const memory: TopologyMemory = { absorbed: new Map(), remote: new Map(), stranded: new Set(), checkouts: null };
      const read = () => readTopology(shadow, project, treeOf(project), memory);
      rememberTopology(memory, yield* read(), yield* sync(project));
      yield* write(project, 'doctrine');
      yield* sync(release);
      yield* write(release, 'release-law');
      yield* sync(delivered);
      yield* sync(dirty);
      const note = yield* write(dirty, 'dirty-note');
      yield* fs.writeFileString(join(treeOf(dirty), 'draft.md'), 'never committed');
      expect((yield* read()).due).toBe(false);
      yield* sh(['worktree', 'remove', delivered], project);
      expect((yield* read()).due).toBe(true);
      yield* sync(project);
      expect(yield* fs.exists(treeOf(delivered))).toBe(false);
      yield* sh(['worktree', 'remove', '--force', dirty], project);
      yield* sh(['branch', '-D', 'delivered', 'dirty'], project);
      const synced = yield* sync(project);
      expect(yield* fs.exists(treeOf(delivered))).toBe(false);
      expect(yield* fs.readFileString(join(treeOf(dirty), 'draft.md'))).toBe('never committed');
      expect(yield* fs.readFileString(join(treeOf(dirty), 'dirty-note.md'))).toBe(note);
      expect(synced.pruned).toEqual(['delivered']);
      expect(synced.stranded.map((entry) => entry.branch)).toEqual(['dirty']);
      expect(yield* sh(['--git-dir', shadow.gitDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/dirty'])).toBe('dirty');
    }),
  );

  it.effect('retires recovery when its target branch leaves the repository', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, checkout, write, sh } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'shared', 'the law');
      const side = yield* checkout('side', 'main');
      yield* sync(side);
      yield* write(side, 'shared', 'as side reads it');
      yield* write(project, 'shared', 'as main reads it');
      const recovery = TreeMerges.at(shadow, treeOf(side));
      expect((yield* recovery.merge('main')).conflicts).toEqual(['shared.md']);
      const pending = yield* recovery.read();
      if (pending === null) return yield* Effect.fail('missing recovery');
      yield* sh(['worktree', 'remove', '--force', side], project);
      yield* sh(['branch', '-D', 'side'], project);
      yield* sync(project);
      expect(yield* recovery.read()).toBeNull();
      expect(yield* fs.exists(pending.path)).toBe(false);
    }),
  );

  it.effect('keeps recovery for a departed incoming branch until a kept twin holds that branch, then retires it before absorb', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { project, shadow, treeOf, sync, checkout, commit, write, sh, level } = yield* twinWorld();
      yield* sync(project);
      yield* write(project, 'shared', 'the law');
      const incoming = yield* checkout('incoming', 'main');
      yield* sync(incoming);
      yield* write(incoming, 'shared', 'as incoming reads it');
      yield* commit(incoming, 'incoming');
      const target = yield* checkout('target', 'main');
      yield* sync(target);
      yield* write(target, 'shared', 'as target reads it');
      yield* sh(['merge', '--no-ff', '-m', 'take incoming', 'incoming'], target);
      yield* syncTopology(shadow, target, treeOf(target), shippedSteps, { treeHold: unheld, level });
      const recovery = TreeMerges.at(shadow, treeOf(target));
      const pending = yield* recovery.read();
      if (pending === null) return yield* Effect.fail('missing recovery');
      expect(pending.theirs).not.toBe(yield* sh(['--git-dir', shadow.gitDir, 'rev-parse', 'incoming']));
      yield* sh(['worktree', 'remove', '--force', incoming], project);
      yield* sh(['branch', '-D', 'incoming'], project);
      yield* sync(project);
      expect((yield* recovery.read())?.id).toBe(pending.id);
      const kept = yield* sh(['commit-tree', 'main^{tree}', '-p', 'main', '-m', 'keeper'], project);
      yield* sh(['branch', 'keeper', kept], project);
      yield* shadow.branch('keeper', 'incoming');
      expect((yield* sync(target)).merges).toEqual([]);
      expect(yield* recovery.read()).toBeNull();
      expect(yield* fs.exists(pending.path)).toBe(false);
    }),
  );
});
