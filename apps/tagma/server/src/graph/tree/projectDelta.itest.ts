import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { spokenId } from '../../platform/contract/wire/ids.js';
import { decodeBlockFile, encodeBlockFile } from './blockFile.js';
import { projectDelta, projectToTree } from './projection.js';

layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('per-act projection', (it) => {
  it.effect('projects a reference, collision, directory rename and trash without rewriting an unmentioned file', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const treeRoot = yield* demo.fixture.directory('tree');
        const delta = (blockIds: number[]) => projectDelta({ projectId, treeRoot, blockIds });
        const doctrine = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'Doctrine' });
        const charter = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'The Charter', parentId: doctrine.id, body: 'law' });
        yield* projectToTree({ projectId, treeRoot });
        const charterPath = join(treeRoot, 'demo/doctrine/the-charter.md');
        const original = yield* decodeBlockFile(yield* fs.readFileString(charterPath));
        const edited = encodeBlockFile({ ...original, body: 'changed outside' });
        yield* fs.writeFileString(charterPath, edited);
        const body = `points at [[${spokenId(charter.uuid)}]]`;
        const note = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Field Note', parentId: doctrine.id, body });
        expect((yield* delta([note.id])).written).toBe(1);
        const file = yield* decodeBlockFile(yield* fs.readFileString(join(treeRoot, 'demo/doctrine/field-note.md')));
        expect([file.frontmatter.id, file.body]).toEqual([note.uuid, body]);
        expect(yield* fs.readFileString(charterPath)).toBe(edited);

        const rival = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Field Note', parentId: doctrine.id });
        yield* delta([rival.id]);
        const names = ['field-note.md', `field-note-${spokenId(rival.uuid)}.md`];
        const ids = yield* Effect.forEach(names, (name) =>
          Effect.flatMap(fs.readFileString(join(treeRoot, 'demo/doctrine', name)), decodeBlockFile),
        );
        expect(ids.map((file) => file.frontmatter.id)).toEqual([note.uuid, rival.uuid]);

        yield* graph.blocks.update({ id: doctrine.id, title: 'The Standing Law' });
        expect((yield* delta([doctrine.id])).moved).toBeGreaterThanOrEqual(1);
        expect((yield* graph.blocks.blockById(charter.id)).path).toBe('demo/the-standing-law/the-charter.md');
        expect(yield* fs.readFileString(join(treeRoot, 'demo/the-standing-law/the-charter.md'))).toBe(edited);
        expect(yield* fs.exists(join(treeRoot, 'demo/doctrine'))).toBe(false);

        const clause = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'First Clause',
          parentId: charter.id,
          body: 'nested',
        });
        yield* delta([clause.id]);
        const grown = join(treeRoot, 'demo/the-standing-law/the-charter');
        expect(yield* fs.readFileString(join(grown, 'index.md'))).toBe(edited);
        const child = yield* decodeBlockFile(yield* fs.readFileString(join(grown, 'first-clause.md')));
        expect([child.frontmatter.id, child.body]).toEqual([clause.uuid, 'nested']);
        yield* graph.trash.delete({ id: charter.id });
        expect((yield* delta([charter.id, clause.id])).removed).toBeGreaterThanOrEqual(1);
        expect(yield* fs.exists(grown)).toBe(false);
      }),
    ),
  );

  it.effect('a block gaining its first child and a new parent in one act moves both into the new shelf', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const treeRoot = yield* demo.fixture.directory('tree');
        const from = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'From' });
        const to = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'To' });
        const mover = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Mover', parentId: from.id, body: 'moves and grows' });
        yield* projectToTree({ projectId, treeRoot });
        const kid = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Kid', parentId: mover.id, body: 'kid' });
        yield* graph.blocks.update({ id: mover.id, parentId: to.id });
        yield* projectDelta({ projectId, treeRoot, blockIds: [mover.id, kid.id] });
        const path = (yield* graph.blocks.blockById(mover.id)).path;
        expect(path).toBe('demo/to/mover/index.md');
        const moved = yield* decodeBlockFile(yield* fs.readFileString(join(treeRoot, 'demo/to/mover/index.md')));
        const child = yield* decodeBlockFile(yield* fs.readFileString(join(treeRoot, 'demo/to/mover/kid.md')));
        expect([moved.frontmatter.id, moved.body, child.frontmatter.id, child.body]).toEqual([
          mover.uuid,
          'moves and grows',
          kid.uuid,
          'kid',
        ]);
        expect(yield* fs.exists(join(treeRoot, 'demo/from/mover.md'))).toBe(false);
      }),
    ),
  );

  it.effect('recreates a vanished flat file while projecting its first child', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const fs = yield* FileSystem.FileSystem;
        const treeRoot = yield* demo.fixture.directory('tree');
        const from = yield* graph.blocks.create({ projectId, tags: ['zone'], title: 'From' });
        const mover = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'Mover',
          parentId: from.id,
          body: 'the standing body',
        });
        yield* projectToTree({ projectId, treeRoot });
        yield* fs.remove(join(treeRoot, 'demo/from/mover.md'));
        const kid = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'Kid', parentId: mover.id, body: 'kid' });
        yield* projectDelta({ projectId, treeRoot, blockIds: [mover.id, kid.id] });
        expect((yield* graph.blocks.blockById(mover.id)).path).toBe('demo/from/mover/index.md');
        const restored = yield* decodeBlockFile(yield* fs.readFileString(join(treeRoot, 'demo/from/mover/index.md')));
        const child = yield* decodeBlockFile(yield* fs.readFileString(join(treeRoot, 'demo/from/mover/kid.md')));
        expect([restored.frontmatter.id, restored.body, child.frontmatter.id, child.body]).toEqual([
          mover.uuid,
          'the standing body',
          kid.uuid,
          'kid',
        ]);
      }),
    ),
  );
});
