import { Effect, FileSystem, Layer, Tracer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { block } from '../../store/tables.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../../composition/testing/graphFixture.js';

type Sources = Parameters<EffectDemo['graph']['review']['propose']>[0]['sources'];

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('proposal conflicts', (it) => {
  it.effect('overlapping edit sources of two open proposals read as a conflict', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const born = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 't', body: 'alpha beta gamma' });
        const target = yield* nameOf(born.id);
        const propose = (title: string, old: string, replacement: string) =>
          Effect.flatMap(
            graph.review.propose({ projectId, title, amendsId: born.id, ops: [{ op: 'edit', id: target, old, new: replacement }] }),
            (row) => Effect.map(nameOf(row.id), (name) => ({ id: row.id, name })),
          );
        const a = yield* propose('first', 'alpha beta', 'ALPHA beta');
        const b = yield* propose('second', 'beta gamma', 'beta GAMMA');
        const c = yield* propose('third', 'gamma', 'GAMMA');
        const whole = yield* graph.review.conflicts({ projectId });
        const { found } = whole;
        expect(whole.total).toBe(2);
        const spans: Tracer.NativeSpan[] = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        for (const name of [a.name, b.name, c.name]) {
          const page = yield* graph.review.conflicts({ projectId, names: [name] }).pipe(Effect.withTracer(tracer));
          expect(page).toEqual({ ...whole, found: found.filter((fight) => fight.a === name || fight.b === name) });
        }
        expect(spans.filter((span) => span.name === 'sql.execute')).toHaveLength(0);
        const pairs = found.map((row) => [row.a, row.b]);
        expect(pairs).toContainEqual([a.name, b.name]);
        expect(pairs).toContainEqual([b.name, c.name]);
        expect(pairs).not.toContainEqual([a.name, c.name]);
        expect(found[0]?.region).toEqual({ kind: 'text', blockName: target });
        yield* Effect.result(
          graph.graphStore.transaction('test.rollback-conflicts', () =>
            Effect.gen(function* () {
              yield* graph.blocks.update({ id: born.id, body: 'alpha gamma beta' });
              expect((yield* graph.review.conflicts({ projectId })).total).toBe(0);
              return yield* Effect.fail('rollback');
            }),
          ),
        );
        expect(yield* graph.review.conflicts({ projectId })).toEqual(whole);
        yield* graph.blocks.update({ id: born.id, body: 'alpha gamma beta' });
        expect((yield* graph.review.conflicts({ projectId })).total).toBe(0);
        yield* graph.blocks.update({ id: born.id, body: 'alpha beta gamma' });
        expect(yield* graph.review.conflicts({ projectId, scopeId: born.id })).toEqual(whole);
        yield* graph.review.revise({ id: b.id, ops: [{ op: 'edit', id: target, old: 'alpha', new: 'ALPHA' }] });
        expect((yield* graph.review.conflicts({ projectId })).found).toEqual([found[0]!]);
        yield* graph.review.reject({ id: b.id, reason: 'merged into a derived proposal' });
        expect((yield* graph.review.conflicts({ projectId })).found).toHaveLength(0);
      }),
    ),
  );

  it.effect('proposals whose sources name the same place read as a conflict, and containment does not', () =>
    withDemo(({ graph, projectId, demoRoot, nameOf, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(demoRoot, 'src'), { recursive: true });
        yield* fs.writeFileString(join(demoRoot, 'src', 'owner.ts'), 'export const a = 1;\nexport const b = 2;\n');
        const target = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 'owns src' });
        const targetName = yield* nameOf(target.id);
        const finding = (title: string, sources: Sources) =>
          Effect.flatMap(
            graph.review.propose({
              projectId,
              title,
              amendsId: target.id,
              ops: [{ op: 'create', tags: ['task'], title, parentId: targetName }],
              sources,
            }),
            (row) => nameOf(row.id),
          );
        const onA = yield* finding('a is wrong', [{ kind: 'symbol', ref: 'src/owner.ts', symbol: 'a' }]);
        const onAToo = yield* finding('a is also wrong', [{ kind: 'symbol', ref: 'src/owner.ts', symbol: 'a' }]);
        const onB = yield* finding('b is wrong', [{ kind: 'symbol', ref: 'src/owner.ts', symbol: 'b' }]);
        const onFile = yield* finding('the module statements are wrong', [{ kind: 'file', ref: 'src/owner.ts' }]);
        const onFileToo = yield* finding('the module is unguarded', [{ kind: 'file', ref: 'src/owner.ts' }]);
        const onDir = yield* finding('the folder is wrong', [{ kind: 'dir', ref: 'src' }]);
        const onDirToo = yield* finding('the folder has no owner', [{ kind: 'dir', ref: 'src' }]);
        const conflicts = (yield* graph.review.conflicts({ projectId })).found;
        const all = (x: string, y: string) => conflicts.filter((row) => (row.a === x && row.b === y) || (row.a === y && row.b === x));
        const between = (x: string, y: string) => all(x, y)[0]?.region;
        expect(between(onA, onAToo)).toEqual({ kind: 'code', anchor: 'src/owner.ts#a' });
        expect(between(onA, onB)).toBeUndefined();
        expect(between(onFile, onFileToo)).toEqual({ kind: 'code', anchor: 'src/owner.ts' });
        expect(all(onFile, onFileToo)).toHaveLength(1);
        expect(between(onDir, onDirToo)).toEqual({ kind: 'code', anchor: 'src' });
        expect(between(onA, onFile)).toBeUndefined();
        expect(between(onFile, onDir)).toBeUndefined();
        expect(between(onB, onDir)).toBeUndefined();
        expect((yield* graph.review.conflicts({ projectId })).total).toBe(3);
        const id = yield* graph.blockNames.idOfName(onAToo);
        yield* graph.sources.unanchor({ blockId: id, kind: 'symbol', ref: 'src/owner.ts', symbol: 'a' });
        expect((yield* graph.review.conflicts({ projectId, names: [onA] })).found).toEqual([]);
        expect((yield* graph.review.conflicts({ projectId })).total).toBe(2);
        const anchored = yield* graph.sources.attach({ blockId: id, kind: 'symbol', ref: 'src/owner.ts', symbol: 'a' });
        expect((yield* graph.review.conflicts({ projectId })).found).toEqual(conflicts);
        const requested = [id, ...Array.from({ length: 32766 }, (_, at) => at + 1_000_000)];
        expect(yield* graph.sources.byBlock(requested)).toEqual(new Map([[id, [anchored]]]));
      }),
    ),
  );

  it.effect('repeated and adjacent edit anchors count each pair once and return the same fights from the worker', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['spec'],
          title: 'repeated text',
          body: 'alpha beta gamma '.repeat(2048),
        });
        const name = yield* nameOf(target.id);
        const proposals = [];
        for (const anchors of [['alpha beta', 'gamma', 'alpha beta'], ['beta gamma'], ['beta']]) {
          const row = yield* graph.review.propose({
            projectId,
            amendsId: target.id,
            title: 'overlapping anchors',
            ops: anchors.map((old) => ({ op: 'edit' as const, id: name, old, new: old.toUpperCase(), all: true })),
          });
          proposals.push(yield* nameOf(row.id));
        }
        const [a, b, c] = proposals as [string, string, string];
        const region = { kind: 'text' as const, blockName: name };
        const whole = yield* graph.review.conflicts({ projectId });
        expect(whole).toEqual({
          found: [
            { a, b, region },
            { a, b: c, region },
            { a: b, b: c, region },
          ],
          total: 3,
          unread: [],
        });
        const spans: Tracer.NativeSpan[] = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const page = yield* graph.review.conflicts({ projectId, names: [c] }).pipe(Effect.withTracer(tracer));
        expect(page).toEqual({ ...whole, found: whole.found.slice(1) });
        expect(yield* graph.review.conflicts({ projectId, names: [] }).pipe(Effect.withTracer(tracer))).toEqual({ ...whole, found: [] });
        expect(spans.filter((span) => span.name === 'sql.execute')).toHaveLength(0);
        yield* Effect.result(
          graph.graphStore.transaction('test.rollback-worker-conflicts', () =>
            Effect.gen(function* () {
              yield* graph.blocks.update({ id: target.id, body: 'alpha delta gamma '.repeat(2048) });
              expect((yield* graph.review.conflicts({ projectId, names: [a] })).total).toBe(0);
              return yield* Effect.fail('rollback');
            }),
          ),
        );
        expect(yield* graph.review.conflicts({ projectId, names: [c] })).toEqual(page);
        yield* graph.blocks.update({ id: target.id, body: 'alpha delta gamma '.repeat(2048) });
        expect((yield* graph.review.conflicts({ projectId, names: [a] })).total).toBe(0);
        yield* graph.blocks.update({ id: target.id, body: 'gone' });
        expect((yield* graph.review.conflicts({ projectId })).found).toEqual([]);
      }),
    ),
  );

  it.effect('a proposal whose operations do not read is named unread with its reason, never as a conflict', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const target = yield* graph.blocks.create({ projectId, parentId: root, tags: ['spec'], title: 'spec' });
        const broken = yield* graph.review.propose({
          projectId,
          title: 'amendment',
          amendsId: target.id,
          ops: [{ op: 'create', tags: ['task'], title: 'x', parentId: yield* nameOf(target.id) }],
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { status: 'open', ops: [] } })
          .where(eq(block.id, broken.id));
        const conflicts = yield* graph.review.conflicts({ projectId });
        expect(conflicts.found).toEqual([]);
        expect(conflicts.unread).toEqual([{ name: yield* nameOf(broken.id), reason: expect.any(String) }]);
      }),
    ),
  );
});
