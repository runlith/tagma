import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { storageHomes, resolveStorageLayout } from '../storage/layout.js';
import { ShadowGit } from '../tree/shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';
import { TreeMerges } from '../tree/merges.js';
import { markerText, readMarker } from '../tree/marker.js';
import { shippedSteps } from '../steps/sequence.js';
import { readBlockTree, writeBlockTree, type TreeBlock } from '../tree/layout.js';
import { graphPool } from '../testing/doubles.js';

const ROOT = '0199cccc-0000-7000-8000-00000000a001';
const LAW = '0199cccc-0000-7000-8000-00000000a002';
const FINDING = '0199cccc-0000-7000-8000-00000000a003';

const blocks = (measured: number, law: string): TreeBlock[] => [
  { parentId: null, frontmatter: { id: ROOT, title: 'Levelling', ord: 1 }, body: 'root' },
  {
    parentId: ROOT,
    frontmatter: { id: LAW, title: 'Law', ord: 1, fields: { enforcement: { baseline: 1, checks: ['tsc'], measured } } },
    body: law,
  },
  {
    parentId: ROOT,
    frontmatter: {
      id: FINDING,
      title: 'Finding',
      ord: 2,
      edges: [
        { kind: 'relates', to: LAW },
        { kind: 'discovered-from', to: LAW },
      ],
    },
    body: 'found',
  },
];

layer(demoGraphLayer({ repos: ['levelling'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'incoming graph levelling',
  (it) => {
    it.effect('successive unstepped merges retain resolved format conflicts and incoming knowledge', () =>
      withDemo(({ graph, context, project, demoRoot }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const checkout = project('levelling').root;
            const row = yield* graph.projectPolicy.setStorage({ id: project('levelling').id, mode: 'stealth' });
            const homes = storageHomes(graph.store.path);
            const current = yield* resolveStorageLayout({ mode: 'stealth', projectId: row.id, ...homes, worktree: checkout });
            if (current.mode !== 'stealth') return yield* Effect.die('the fixture requires a stealth tree');
            const shadow = yield* ShadowGit.open(current.gitDir, graph.git, NO_SIDE);
            const git = (...args: string[]) => runGit(graph.git, 'test-levelling', args);
            const main = yield* git('-C', checkout, 'symbolic-ref', '--short', 'HEAD');
            if (main !== 'main') yield* shadow.branch(main, 'main');
            yield* shadow.attach(current.treeRoot, main);
            yield* shadow.recordCheckout(current.treeRoot, checkout, checkout);
            yield* writeBlockTree(current.treeRoot, blocks(2, 'the law'));
            yield* fs.writeFileString(join(current.treeRoot, FORMAT_FILE), markerText(null));
            yield* shadow.commitAct(current.treeRoot, 'graph before the steps');
            const branch = join(checkout, '..', 'feature');
            yield* git('-C', checkout, 'worktree', 'add', '-b', 'feature', branch);
            const feature = yield* resolveStorageLayout({ mode: 'stealth', projectId: row.id, ...homes, worktree: branch });
            yield* shadow.branch('feature', main);
            yield* shadow.recordFork('feature', yield* git('-C', branch, 'rev-parse', 'HEAD'));
            yield* shadow.attach(feature.treeRoot, 'feature');
            yield* shadow.recordCheckout(feature.treeRoot, checkout, branch);
            yield* writeBlockTree(feature.treeRoot, blocks(3, 'the law as the feature reads it'));
            yield* shadow.commitAct(feature.treeRoot, 'the feature rewrites the finding');
            yield* fs.writeFileString(join(branch, 'code.txt'), 'feature');
            yield* git('-C', branch, 'add', '-A');
            yield* git('-C', branch, 'commit', '-m', 'feature code');
            yield* git('-C', checkout, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
            const pool = yield* Effect.acquireRelease(
              graphPool({
                machine: Context.add(context, Catalogs, NO_CATALOGS),
                sourcePath: demoRoot,
                identity: testSessionIdentity,
                migrations: fixtureGraphMigrations,
              }),
              (held) => held.dispose(),
            );
            yield* pool.resolve({ projectId: row.id, cwd: checkout });
            expect(yield* TreeMerges.at(shadow, current.treeRoot).read()).toBeNull();
            const law = (yield* readBlockTree(current.treeRoot)).find((block) => block.frontmatter.id === LAW);
            expect(law?.body).toBe('the law as the feature reads it');
            expect(law?.frontmatter.fields?.enforcement).toEqual({ checks: ['tsc'] });
            expect(yield* fs.readDirectory(join(dirname(graph.store.path), 'levelling'))).toEqual([]);
            expect(yield* readMarker(join(current.treeRoot, FORMAT_FILE))).toEqual({ kind: 'read', step: shippedSteps.last });
            yield* pool.releaseProject(row.id);
            const currentBlocks = yield* readBlockTree(current.treeRoot);
            yield* writeBlockTree(
              current.treeRoot,
              currentBlocks.map((block) => (block.frontmatter.id === LAW ? { ...block, body: 'main amendment' } : block)),
            );
            yield* shadow.commitAct(current.treeRoot, 'main amends the law');
            yield* writeBlockTree(feature.treeRoot, blocks(3, 'feature amendment'));
            yield* shadow.commitAct(feature.treeRoot, 'feature amends the law');
            yield* pool.resolve({ projectId: row.id, cwd: checkout });
            const recovery = TreeMerges.at(shadow, current.treeRoot);
            const pending = yield* recovery.read();
            expect(pending?.conflicts).toContain('levelling/law.md');
            if (pending === null) return yield* Effect.die('the competing amendments must conflict');
            yield* writeBlockTree(
              pending.path,
              currentBlocks.map((block) =>
                block.frontmatter.id === LAW
                  ? {
                      ...block,
                      frontmatter: { ...block.frontmatter, fields: { enforcement: { checks: ['resolved'] } } },
                      body: 'resolved law',
                    }
                  : block,
              ),
            );
            yield* recovery.finish('tree');
            yield* pool.releaseProject(row.id);
            yield* writeBlockTree(
              feature.treeRoot,
              blocks(3, 'feature amendment').map((block) =>
                block.frontmatter.id === FINDING ? { ...block, body: 'a new finding' } : block,
              ),
            );
            yield* shadow.commitAct(feature.treeRoot, 'feature records another finding');
            yield* pool.resolve({ projectId: row.id, cwd: checkout });
            expect(yield* recovery.read()).toBeNull();
            const merged = yield* readBlockTree(current.treeRoot);
            expect(merged.find((block) => block.frontmatter.id === LAW)?.body).toBe('resolved law');
            expect(merged.find((block) => block.frontmatter.id === LAW)?.frontmatter.fields?.enforcement).toEqual({ checks: ['resolved'] });
            expect(merged.find((block) => block.frontmatter.id === FINDING)?.body).toBe('a new finding');
          }),
        ),
      ),
    );
  },
);
