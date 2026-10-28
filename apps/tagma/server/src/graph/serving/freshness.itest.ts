import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { runGit } from '../../platform/git/ownGit.js';
import { Selection } from '../contract/service/reads.js';
import { blockName } from '../contract/wire/references.js';
import { Catalogs, NO_CATALOGS } from '../contract/wire/catalogs.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { storageHomes, resolveStorageLayout } from '../storage/layout.js';
import { ShadowGit } from '../tree/shadow.js';
import { markerText } from '../tree/marker.js';
import { shippedSteps } from '../steps/sequence.js';
import { treeLedger } from '../tree/ledger.js';
import { readBlockTree, writeBlockTree } from '../tree/layout.js';
import { graphPool } from '../testing/doubles.js';

const rootId = '0199bbbb-0000-7000-8000-0000cafe0099';

layer(demoGraphLayer({ repos: ['topology'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'copy freshness',
  (it) => {
    it.effect('healthy reads name an unflushed sibling without absorbing it, and absorb its knowledge once it recovers', () =>
      withDemo(({ graph, context, project, demoRoot, refusal }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const checkout = project('topology').root;
            const row = yield* graph.projectPolicy.setStorage({ id: project('topology').id, mode: 'stealth' });
            const homes = storageHomes(graph.store.path);
            const current = yield* resolveStorageLayout({ mode: 'stealth', projectId: row.id, ...homes, worktree: checkout });
            if (current.mode !== 'stealth') return yield* Effect.die('the fixture requires a stealth tree');
            const shadow = yield* ShadowGit.open(current.gitDir, graph.git, null);
            const git = (...args: string[]) => runGit(graph.git, 'test-topology', args);
            const main = yield* git('-C', checkout, 'symbolic-ref', '--short', 'HEAD');
            if (main !== 'main') yield* shadow.branch(main, 'main');
            yield* shadow.attach(current.treeRoot, main);
            yield* shadow.recordCheckout(current.treeRoot, checkout, checkout);
            const root = { parentId: null, frontmatter: { id: rootId, title: 'Topology', ord: 1 }, body: 'Main' };
            yield* writeBlockTree(current.treeRoot, [root]);
            yield* fs.writeFileString(join(current.treeRoot, FORMAT_FILE), markerText(shippedSteps.last));
            yield* shadow.commitAct(current.treeRoot, 'main graph');
            const sibling = join(checkout, '..', 'subject');
            yield* git('-C', checkout, 'worktree', 'add', '-b', 'subject', sibling);
            const failed = yield* resolveStorageLayout({ mode: 'stealth', projectId: row.id, ...homes, worktree: sibling });
            yield* shadow.branch('subject', main);
            yield* shadow.recordFork('subject', yield* git('-C', sibling, 'rev-parse', 'HEAD'));
            yield* shadow.attach(failed.treeRoot, 'subject');
            yield* shadow.recordCheckout(failed.treeRoot, checkout, sibling);
            yield* writeBlockTree(failed.treeRoot, [{ ...root, body: 'Committed branch value' }]);
            yield* shadow.commitAct(failed.treeRoot, 'branch graph');
            yield* fs.writeFileString(join(sibling, 'code.txt'), 'subject');
            yield* git('-C', sibling, 'add', '-A');
            yield* git('-C', sibling, 'commit', '-m', 'subject code');
            yield* git('-C', checkout, 'merge', '--no-ff', 'subject', '-m', 'merge code');
            const pool = yield* Effect.acquireRelease(
              graphPool({
                machine: Context.add(context, Catalogs, NO_CATALOGS),
                sourcePath: demoRoot,
                identity: testSessionIdentity,
                migrations: fixtureGraphMigrations,
              }),
              (held) => held.dispose(),
            );
            let broken = true;
            const failure = new GateRefusal('graph-pool', 'The branch batch cannot be committed', ['Repair this branch batch']);
            yield* Effect.acquireRelease(
              pool.freshnessGate.register(failed.treeRoot, {
                checkout: sibling,
                row,
                layout: failed,
                roots: { root: failed.treeRoot, stealth: null },
                prefix: '',
                shadow,
                poolContext: context,
                ledger: yield* treeLedger({ root: failed.treeRoot, stealth: null }, row.id),
                batches: {
                  land: () => Effect.die('this sibling lands no acts'),
                  carry: () => Effect.void,
                  flush: Effect.suspend(() => (broken ? Effect.fail(failure) : Effect.void)),
                },
                topology: null,
                scope: yield* Effect.scope,
              }),
              (held) => Effect.sync(held.unregister),
            );
            const name = blockName(rootId);
            const titles = [{ name, uuid: rootId, title: 'Topology', projectId: row.id }];
            const served = yield* pool.resolve({ projectId: row.id, cwd: checkout });
            expect(yield* Context.get(served.context, Selection).titles([name])).toEqual(titles);
            expect(yield* served.copyFailures()).toMatchObject([
              { copy: { projectId: row.id, checkout: sibling, tree: failed.treeRoot }, error: { code: failure.code } },
            ]);
            expect((yield* Context.get(served.context, Selection).roots(row.id)).map((root) => root.body)).toEqual(['Main']);
            expect(yield* refusal(pool.freshnessGate.prepareTopology({ row, checkout: sibling, layout: failed, shadow }))).toBe(failure);
            yield* pool.release(served);
            broken = false;
            const recovered = yield* pool.resolve({ projectId: row.id, cwd: checkout });
            expect(yield* Context.get(recovered.context, Selection).titles([name])).toEqual(titles);
            expect(yield* recovered.copyFailures()).toEqual([]);
            expect((yield* readBlockTree(current.treeRoot)).find((block) => block.frontmatter.id === rootId)?.body).toBe(
              'Committed branch value',
            );
          }),
        ),
      ),
    );
  },
);
