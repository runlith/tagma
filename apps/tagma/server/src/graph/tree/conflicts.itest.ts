import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { ownGitLayer } from '../../platform/git/ownGit.js';
import { treeConflicts, resolveConflict } from './conflicts.js';
import { ShadowGit } from './shadow.js';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(spawning)));
const LAW = '0198c3d4-7b2a-7f00-8000-000000000001';
const block = (body: string, id = LAW) => `---\nid: ${id}\ntitle: law\nord: 1\n---\n${body}`;
const foreign = block('foreign', '0198c3d4-7b2a-7f00-8000-99999999ffff');
const resolveRefusal = { _tag: 'OwnGitFailed', op: 'resolve', ran: true, reason: 'refused' };

class Template extends Context.Service<Template, string>()('testing/ConflictTemplate') {}

const template = Layer.effect(
  Template,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'conflict-template-' });
    const shadow = yield* ShadowGit.openInPlace(root, yield* Git);
    yield* fs.writeFileString(join(root, 'law.md'), block('the original'));
    yield* shadow.commitAct(root, 'create law');
    yield* shadow.run('branch', ['-C', root, 'switch', '-c', 'rival']);
    yield* fs.writeFileString(join(root, 'law.md'), block('the rival truth'));
    yield* shadow.commitAct(root, 'edit on rival');
    yield* shadow.run('checkout', ['-C', root, 'switch', 'main']);
    return root;
  }),
).pipe(Layer.provideMerge(Layer.merge(platform, git)));

const conflictedWorld = Effect.fnUntraced(function* (ours: string) {
  const fs = yield* FileSystem.FileSystem;
  const tree = yield* fs.makeTempDirectoryScoped({ prefix: 'conflicts-' });
  yield* fs.copy(yield* Template, tree, { overwrite: true });
  const shadow = yield* ShadowGit.openInPlace(tree, yield* Git);
  yield* fs.writeFileString(join(tree, 'law.md'), ours);
  yield* shadow.commitAct(tree, 'edit on main');
  expect(yield* shadow.merge(tree, 'rival', 'merge rival')).toEqual({ merged: null, conflicts: ['law.md'] });
  return { shadow, tree };
});

layer(template, { excludeTestServices: true })('graph conflicts', (it) => {
  it.effect('rejects invalid resolutions without changing the conflict, then concludes a valid merge', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { shadow, tree } = yield* conflictedWorld(block('the main truth'));
      const conflicts = treeConflicts({ treeRoot: tree, ownGit: true, git: yield* Git });
      expect((yield* conflicts).map(({ evidence, ...finding }) => ({ ...finding, evidence: JSON.parse(evidence) }))).toEqual([
        { path: 'law.md', blockId: LAW, evidence: { path: 'law.md', ownGit: true } },
      ]);
      const before = yield* fs.readFileString(join(tree, 'law.md'));
      expect(yield* Effect.flip(resolveConflict(shadow, tree, 'law.md', 'no fence'))).toMatchObject({
        _tag: 'BlockFileInvalid',
        reason: 'frontmatter-missing',
      });
      expect(yield* Effect.flip(resolveConflict(shadow, tree, 'law.md', foreign))).toMatchObject(resolveRefusal);
      expect(yield* fs.readFileString(join(tree, 'law.md'))).toBe(before);
      expect(yield* shadow.unmergedPaths(tree)).toEqual(['law.md']);
      const text = block('the merged truth');
      expect(yield* resolveConflict(shadow, tree, 'law.md', text, 'jade-ibis')).toEqual({ remaining: [], merged: expect.any(String) });
      expect(yield* fs.readFileString(join(tree, 'law.md'))).toBe(text);
      expect(yield* conflicts).toEqual([]);
      expect(yield* Effect.flip(resolveConflict(shadow, tree, 'law.md', 'anything'))).toMatchObject(resolveRefusal);
    }),
  );

  it.effect('carries an unreadable side diagnostic into the refused resolution', () =>
    Effect.gen(function* () {
      const { shadow, tree } = yield* conflictedWorld('no fence on our side');
      const findings = yield* treeConflicts({ treeRoot: tree, ownGit: true, git: yield* Git });
      expect(findings).toEqual([{ path: 'law.md', blockId: null, evidence: expect.any(String) }]);
      const evidence = JSON.parse(findings[0]!.evidence);
      expect(evidence).toEqual({ path: 'law.md', ownGit: true, unreadable: expect.any(String) });
      const refused = yield* Effect.flip(resolveConflict(shadow, tree, 'law.md', foreign));
      expect(refused).toMatchObject(resolveRefusal);
      expect(refused.message).toContain(evidence.unreadable);
    }),
  );
});
