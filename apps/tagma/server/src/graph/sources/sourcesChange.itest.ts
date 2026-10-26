import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('source changes', (it) => {
  it.effect('a tag that stands over a place is held to it on the way out, not only at birth', () =>
    withDemo(({ graph, projectId, demoRoot, refusal }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(demoRoot, 'territory'), { recursive: true });
        yield* fs.writeFileString(join(demoRoot, 'territory', 'one.ts'), 'export const one = 1;\n');
        yield* graph.blocks.create({
          projectId,
          tags: ['tag'],
          title: '#part',
          fields: {
            id: 'part',
            sources: ['dir', 'file'],
            gates: [{ gate: 'source-required', kinds: ['dir', 'file'] }],
            roles: { container: true },
          },
        });
        yield* graph.tags.forget(projectId);
        const { id } = yield* graph.blocks.create({
          projectId,
          tags: ['part'],
          title: 'a part with a law of its own',
          sources: [{ kind: 'dir', ref: 'territory' }],
        });
        const unanchor = yield* refusal(graph.sources.unanchor({ blockId: id, kind: 'dir', ref: 'territory' }));
        expect(unanchor.code).toBe('source-required');
        expect((yield* graph.sources.of(id)).map((row) => row.ref)).toEqual(['territory']);
        const receiver = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'a receiver' });
        const transfer = yield* refusal(graph.sources.attach({ blockId: receiver.id, kind: 'dir', ref: 'territory', fromId: id }));
        expect(transfer.code).toBe('source-required');
        expect((yield* graph.sources.of(id)).map((row) => row.ref)).toEqual(['territory']);
        expect(yield* graph.sources.of(receiver.id)).toEqual([]);
        const newborn = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'observes the territory',
          parentId: id,
          sources: [{ kind: 'dir', ref: 'territory' }],
        });
        expect((yield* graph.sources.of(newborn.id)).map((row) => row.ref)).toEqual(['territory']);
        expect((yield* graph.sources.of(id)).map((row) => row.ref)).toEqual(['territory']);
        yield* fs.makeDirectory(join(demoRoot, 'other'), { recursive: true });
        yield* fs.writeFileString(join(demoRoot, 'other', 'two.ts'), 'export const two = 1;\n');
        yield* graph.sources.attach({ blockId: id, kind: 'dir', ref: 'other' });
        yield* graph.sources.unanchor({ blockId: id, kind: 'dir', ref: 'territory' });
        expect((yield* graph.sources.of(id)).map((row) => row.ref)).toEqual(['other']);
      }),
    ),
  );

  it.effect('--from hands one over in one transaction, and a donor that never held it refuses', () =>
    withDemo(({ graph, projectId, demoRoot, refusal }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(join(demoRoot, 'owner.ts'), 'export const owner = 1;\n');
        yield* fs.writeFileString(join(demoRoot, 'other.ts'), 'export const other = 1;\n');
        const from = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'used to own it' });
        const to = yield* graph.blocks.create({ projectId, title: 'owns it now' });
        yield* graph.sources.attach({ blockId: from.id, kind: 'symbol', ref: 'owner.ts', symbol: 'owner' });
        const moved = yield* graph.sources.attach({ blockId: to.id, kind: 'symbol', ref: 'owner.ts', symbol: 'owner', fromId: from.id });
        expect(moved.blockId).toBe(to.id);
        expect(yield* graph.sources.of(from.id)).toEqual([]);
        const refused = yield* refusal(graph.sources.attach({ blockId: from.id, kind: 'file', ref: 'other.ts', fromId: to.id }));
        expect(refused.code).toBe('no-source');
        expect(refused.unblock.length).toBeGreaterThan(0);
        expect(yield* graph.sources.of(from.id)).toEqual([]);
        expect((yield* graph.sources.of(to.id)).map((row) => row.symbol)).toEqual(['owner']);
      }),
    ),
  );
});
