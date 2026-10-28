import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { mintBlockId } from '../contract/wire/identity.js';
import { projectToTree } from '../tree/projection.js';
import { scanTree } from '../tree/scan.js';
import { adoptIdentities } from './identities.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('identity adoption', (it) => {
  it.effect('adopts the target identity across files, edges, body references and the mirror', () =>
    withDemo(({ graph, projectId, demoRoot, nameOf, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const shelf = yield* graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'Shelf' });
        const born = yield* graph.blocks.create({ projectId, parentId: shelf.id, tags: ['idea'], title: 'Born card' });
        const spoken = yield* nameOf(born.id);
        const pointer = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['idea'],
          title: 'Pointer',
          body: `see [[${spoken}]]`,
        });
        yield* graph.edges.link({ fromId: pointer.id, kind: 'relates', toId: born.id });
        yield* graph.edges.link({ fromId: shelf.id, kind: 'relates', toId: born.id });
        const treeRoot = join(demoRoot, 'adopt-levelled');
        const target = join(demoRoot, 'adopt-target');
        yield* projectToTree({ projectId, treeRoot });
        yield* fs.copy(treeRoot, target);
        const before = yield* scanTree(treeRoot);
        const bornFile = join(target, before.blocks.find((one) => one.frontmatter.id === born.uuid)!.path);
        const theirs = mintBlockId();
        yield* fs.writeFileString(bornFile, (yield* fs.readFileString(bornFile)).replace(born.uuid, theirs));
        const known = new Set(before.blocks.map((one) => one.frontmatter.id).filter((id) => id !== born.uuid));

        expect(yield* adoptIdentities({ projectId, treeRoot, target, known })).toBe(1);

        const after = yield* scanTree(treeRoot);
        expect(after.blocks.map((one) => one.frontmatter.id).sort()).toEqual([...known, theirs].sort());
        const pointing = after.blocks.find((one) => one.frontmatter.id === pointer.uuid)!;
        expect(pointing.frontmatter.edges).toEqual([{ kind: 'relates', to: theirs }]);
        expect(pointing.body).toBe(`see [[${theirs.replaceAll('-', '').slice(-spoken.length)}]]`);
        expect(after.blocks.find((one) => one.frontmatter.id === shelf.uuid)?.frontmatter.edges).toEqual([{ kind: 'relates', to: theirs }]);
        const [row] = yield* graph.selection.records([born.id]);
        expect(row?.uuid).toBe(theirs);
        expect(row?.path).toBe(after.blocks.find((one) => one.frontmatter.id === theirs)!.path);
      }),
    ),
  );
});
