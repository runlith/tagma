import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('source places', (it) => {
  it.effect('the sources at a place answer with each one’s block and area, and the standing owners of the file', () =>
    withDemo(({ graph, projectId, demoRoot, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(demoRoot, 'src'), { recursive: true });
        yield* fs.writeFileString(join(demoRoot, 'src', 'reader.ts'), 'export function read() {}\n');
        const area = yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'engine' });
        const doc = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'the reader',
          parentId: area.id,
          sources: [{ kind: 'symbol', ref: 'src/reader.ts', symbol: 'read' }],
        });
        const rootDoc = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['idea'],
          title: 'the file',
          sources: [{ kind: 'file', ref: 'src/reader.ts' }],
        });
        const done = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'shipped', parentId: area.id });
        yield* graph.sources.attach({ blockId: done.id, kind: 'file', ref: 'src/reader.ts' });
        yield* graph.tasks.claim({ id: done.id });
        yield* graph.tasks.finish({ id: done.id });
        const trashed = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['idea'],
          title: 'gone',
          sources: [{ kind: 'file', ref: 'src/reader.ts' }],
        });
        yield* graph.trash.delete({ id: trashed.id });
        const first = yield* graph.sources.atPlacePage(projectId, 'src/reader.ts', undefined, 2);
        expect(first.total).toBe(3);
        const last = first.rows[first.rows.length - 1];
        const rest =
          last === undefined
            ? []
            : (yield* graph.sources.atPlacePage(projectId, 'src/reader.ts', [last.source.symbol ?? '', last.block.id, last.source.id], 2))
                .rows;
        expect([...first.rows, ...rest].map((row) => [row.source.symbol, row.block.id, row.area.title])).toEqual([
          [null, rootDoc.id, 'demo'],
          [null, done.id, 'engine'],
          ['read', doc.id, 'engine'],
        ]);
        const owners = yield* graph.sources.ownersOf(projectId, 'src/reader.ts');
        expect(owners.map((row) => row.id)).toEqual([rootDoc.id]);
      }),
    ),
  );

  it.effect('a directory move re-points every source under it', () =>
    withDemo(({ graph, projectId, demoRoot, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(demoRoot, 'old', 'src'), { recursive: true });
        yield* fs.writeFileString(join(demoRoot, 'old', 'src', 'core.ts'), 'export const core = 1;\n');
        const doc = yield* graph.blocks.create({ projectId, parentId: root, title: 'the core' });
        const area = yield* graph.blocks.create({ projectId, parentId: root, title: 'the zone' });
        yield* graph.sources.attach({ blockId: doc.id, kind: 'symbol', ref: 'old/src/core.ts', symbol: 'core' });
        yield* graph.sources.attach({ blockId: area.id, kind: 'dir', ref: 'old' });
        yield* fs.rename(join(demoRoot, 'old'), join(demoRoot, 'new'));
        const moved = yield* graph.sources.relocate({ projectId, from: 'old', to: 'new' });
        expect(moved.map((row) => row.to).sort()).toEqual(['new', 'new/src/core.ts#core']);
        expect((yield* graph.reading.show(doc.id, 0)).sources[0]?.ref).toBe('new/src/core.ts');
      }),
    ),
  );

  it.effect('a symbol is renamed where it stands, and a place nothing watches refuses', () =>
    withDemo(({ graph, projectId, demoRoot, refusal, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(join(demoRoot, 'events.ts'), 'export type Old = { readonly a: 1 };\n');
        const { id } = yield* graph.blocks.create({ projectId, parentId: root, tags: ['idea'], title: 'the event' });
        yield* graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'events.ts', symbol: 'Old' });
        yield* fs.writeFileString(join(demoRoot, 'events.ts'), 'export type New = { readonly a: 1 };\n');
        yield* graph.sources.relocate({ projectId, from: 'events.ts#Old', to: 'events.ts#New' });
        expect((yield* graph.reading.show(id, 0)).sources[0]?.symbol).toBe('New');
        expect((yield* refusal(graph.sources.relocate({ projectId, from: 'nothing', to: 'somewhere' }))).code).toBe('no-source');
        expect((yield* refusal(graph.sources.relocate({ projectId, from: 'events.ts', to: 'events.ts#New' }))).code).toBe(
          'relocation-shape',
        );
      }),
    ),
  );
});
