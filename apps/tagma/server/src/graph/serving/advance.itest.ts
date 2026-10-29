import { expect } from 'bun:test';
import { GRAPH_STEPS, graphSteps, shippedSteps } from '../steps/sequence.js';
import { layer } from '@runlith/effect-test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerText } from '../tree/marker.js';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { runGit } from '../../platform/git/ownGit.js';

import { block } from '../store/tables.js';
import { projectToTree } from '../tree/projection.js';
import { scanTree } from '../tree/scan.js';
import { openFormat } from './format.js';
import { advanceTree } from './advance.js';

layer(demoGraphLayer(), { excludeTestServices: true })('graph steps', (it) => {
  it.effect('advancing imports the tree once and publishes migrated rows, search, references and holders together', () =>
    withDemo(({ graph, projectId, fixture, nameOf }) =>
      Effect.gen(function* () {
        const root = yield* graph.blocks.rootBlockOf(projectId);
        const old = yield* graph.blocks.create({ projectId, parentId: root.id, title: 'Old claim' });
        const kept = yield* graph.blocks.create({ projectId, parentId: old.id, title: 'Kept', body: 'orchid' });
        const task = yield* graph.blocks.create({ projectId, parentId: root.id, tags: ['task'], title: 'Held work' });
        yield* graph.tasks.claim({ id: task.id });
        const held = yield* graph.blocks.blockById(task.id);
        const pointer = yield* graph.blocks.create({
          projectId,
          parentId: root.id,
          title: 'Pointer',
          body: `[[${yield* nameOf(kept.id)}]]`,
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ tags: ['claim'] })
          .where(eq(block.id, old.id));
        const treeRoot = yield* fixture.directory('advance-tree');
        yield* runGit(graph.git, 'init', ['init', '-q'], { cwd: treeRoot });
        yield* projectToTree({ projectId, treeRoot });
        yield* graph.graphStore.db.update(block).set({ body: 'stale mirror' }).where(eq(block.id, kept.id));
        const project = (yield* graph.projectPolicy.read([projectId])).get(projectId)!;
        const format = yield* openFormat(treeRoot, shippedSteps);
        const input = { project, treeRoot, shadow: null, git: graph.git, format, steps: shippedSteps, fromTree: false };

        expect(yield* advanceTree(input)).toBe(true);
        const imported = yield* graph.blocks.blockById(kept.id);
        expect(imported.parentId).toBe(root.id);
        expect(imported.body).toBe('orchid');
        expect((yield* graph.blocks.blockById(task.id)).fields).toEqual(held.fields);
        expect((yield* graph.reading.show(pointer.id, 0)).refsOut).toEqual([yield* nameOf(kept.id)]);
        expect((yield* graph.ranking.search({ projectId, query: 'orchid' })).items.map((row) => row.name)).toEqual([
          yield* nameOf(kept.id),
        ]);
        const tree = yield* scanTree(treeRoot);
        expect(tree.blocks.find((row) => row.frontmatter.id === kept.uuid)?.parentId).toBe(root.uuid);
        expect(tree.blocks.some((row) => row.frontmatter.id === old.uuid)).toBe(false);
        expect(yield* advanceTree(input)).toBe(false);
      }),
    ),
  );

  it.effect('a tree written before claims left reads its claim-era frontmatter, and the steps rewrite it in the current form', () =>
    withDemo(({ graph, projectId, fixture, root }) =>
      Effect.gen(function* () {
        const measured = yield* graph.blocks.create({ projectId, parentId: root, title: 'Measured once' });
        const treeRoot = yield* fixture.directory('claim-era-tree');
        yield* runGit(graph.git, 'init', ['init', '-q'], { cwd: treeRoot });
        yield* projectToTree({ projectId, treeRoot });
        const path = join(treeRoot, (yield* scanTree(treeRoot)).blocks.find((row) => row.frontmatter.id === measured.uuid)!.path);
        const written = yield* Effect.promise(() => readFile(path, 'utf8'));
        const stamp = '2026-08-20T02:25:07.341Z';
        yield* Effect.promise(() =>
          writeFile(
            path,
            written.replace(
              '\n---\n',
              `\nverifiedAt: ${stamp}\nsources:\n  - kind: file\n    ref: src/kept.ts\n    fingerprint: 9f2c\n    verifiedAt: ${stamp}\n  - kind: check\n    ref: checks/retired\n---\n`,
            ),
          ),
        );
        yield* Effect.promise(() => writeFile(join(treeRoot, FORMAT_FILE), markerText(GRAPH_STEPS.at(-2)!.id)));
        const project = (yield* graph.projectPolicy.read([projectId])).get(projectId)!;
        const format = yield* openFormat(treeRoot, shippedSteps);

        expect(yield* advanceTree({ project, treeRoot, shadow: null, git: graph.git, format, steps: shippedSteps, fromTree: false })).toBe(
          true,
        );
        const rewritten = (yield* scanTree(treeRoot)).blocks.find((row) => row.frontmatter.id === measured.uuid);
        expect(rewritten?.frontmatter.sources).toEqual([{ kind: 'file', ref: 'src/kept.ts' }]);
        expect(yield* Effect.promise(() => readFile(path, 'utf8'))).not.toContain('verifiedAt');
      }),
    ),
  );

  it.effect(
    'the steps prove the numbered holders this copy claimed and keep the others numbered, so the branch merges cleanly with the copy that proves them',
    () =>
      withDemo(({ graph, projectId, fixture, as, table, root }) =>
        Effect.gen(function* () {
          const claimed = yield* graph.blocks.create({ projectId, parentId: root, tags: ['task'], title: 'Claimed in this copy' });
          const held = yield* as('here', graph.tasks.claim({ id: claimed.id }));
          const number = (yield* table()).holderOf(held)!;
          const carried = yield* graph.blocks.create({
            projectId,
            parentId: root,
            tags: ['task'],
            title: 'Held by a number another copy gave',
          });
          yield* graph.graphStore.db.update(block).set({ fields: held.fields }).where(eq(block.id, carried.id));
          const treeRoot = yield* fixture.directory('proven-tree');
          const git = (...args: string[]) =>
            runGit(graph.git, args[0]!, ['-c', 'user.name=test', '-c', 'user.email=test@test', ...args], { cwd: treeRoot });
          yield* git('init', '-q');
          yield* projectToTree({ projectId, treeRoot });
          const scanned = (yield* scanTree(treeRoot)).blocks;
          const fileOf = (uuid: string) => join(treeRoot, scanned.find((row) => row.frontmatter.id === uuid)!.path);
          const spell = (path: string, from: string, to: string) =>
            Effect.promise(async () => writeFile(path, (await readFile(path, 'utf8')).replace(from, to)));
          for (const row of [claimed, carried]) yield* spell(fileOf(row.uuid), '"test:here"', String(number));
          const before = GRAPH_STEPS[GRAPH_STEPS.findIndex((step) => step.id === '20261023130000_holders_proven') - 1]!.id;
          yield* Effect.promise(() => writeFile(join(treeRoot, FORMAT_FILE), markerText(before)));
          yield* git('add', '-A');
          yield* git('commit', '-q', '-m', 'base');
          yield* git('checkout', '-q', '-b', 'owner');
          yield* spell(fileOf(carried.uuid), `"holder": ${number}`, '"holder": "test:owner"');
          yield* git('commit', '-q', '-am', 'the copy that gave the number proves it');
          yield* git('checkout', '-q', '-');
          const project = (yield* graph.projectPolicy.read([projectId])).get(projectId)!;
          const format = yield* openFormat(treeRoot, shippedSteps);

          expect(
            yield* advanceTree({ project, treeRoot, shadow: null, git: graph.git, format, steps: shippedSteps, fromTree: false }),
          ).toBe(true);
          expect((yield* table()).holderOf(yield* graph.blocks.blockById(carried.id))).not.toBe(number);
          yield* git('add', '-A');
          yield* git('commit', '-q', '-m', 'graph steps');
          yield* git('merge', '-q', '--no-edit', 'owner');
          const holderLine = (uuid: string) =>
            Effect.promise(async () =>
              (await readFile(fileOf(uuid), 'utf8'))
                .split('\n')
                .find((line) => line.includes('"holder"'))
                ?.trim(),
            );
          expect([yield* holderLine(claimed.uuid), yield* holderLine(carried.uuid)]).toEqual([
            '"holder": "test:here",',
            '"holder": "test:owner",',
          ]);
        }),
      ),
  );

  it.effect('after a fold a tree below the base refuses writes naming the release that brings it to the base', () =>
    withDemo(({ projectId, fixture }) =>
      Effect.gen(function* () {
        const [first, second, base, next, ...rest] = GRAPH_STEPS;
        const folded = graphSteps([next!, ...rest], { step: base!.id, release: '0.2.0' });
        const treeRoot = yield* fixture.directory('folded-tree');
        yield* projectToTree({ projectId, treeRoot });
        const marked = (step: string) =>
          Effect.andThen(
            Effect.promise(() => writeFile(join(treeRoot, FORMAT_FILE), markerText(step))),
            Effect.flatMap(openFormat(treeRoot, folded), (format) => Effect.flip(format.writable)),
          );

        for (const step of [first!.id, second!.id]) {
          const refused = yield* marked(step);
          expect(refused.code).toBe('vocabulary-older');
          expect(refused.unblock[0]).toContain('0.2.0');
        }
        expect((yield* marked('29991231000000_future_step')).code).toBe('vocabulary-newer');
        yield* Effect.promise(() => writeFile(join(treeRoot, FORMAT_FILE), markerText(base!.id)));
        const atBase = yield* openFormat(treeRoot, folded);
        yield* atBase.writable;
        expect(folded.after(atBase.reached()).map((step) => step.id)).toEqual([next!.id, ...rest.map((step) => step.id)]);

        const whole = graphSteps([], { step: base!.id, release: '0.2.0' });
        const wholly = yield* openFormat(treeRoot, whole);
        yield* wholly.writable;
        expect([whole.last, whole.after(wholly.reached())]).toEqual([base!.id, []]);
      }),
    ),
  );
});
