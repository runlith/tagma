import { Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';

const lens = ({ graph, projectId }: EffectDemo) => {
  const spec = (title: string) => Effect.map(graph.blocks.create({ projectId, tags: ['spec'], title }), (row) => row.id);
  const chain = Effect.gen(function* () {
    const first = yield* spec('v1');
    const second = yield* spec('v2');
    const third = yield* spec('v3');
    yield* graph.standing.supersede({ oldId: first, withId: second });
    yield* graph.standing.supersede({ oldId: second, withId: third });
    return { first, second, third };
  });
  const superseded = (id: number) => Effect.map(graph.reading.show(id, 0), (page) => page.superseded);
  return { spec, chain, superseded };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('supersede', (it) => {
  it.effect('supersede writes the edge, and the old block reads as superseded', () =>
    withLens(({ graph, spec, superseded, refusal, table }) =>
      Effect.gen(function* () {
        const oldSpec = yield* spec('v1');
        const newSpec = yield* spec('v2');
        const retired = yield* graph.standing.supersede({ oldId: oldSpec, withId: newSpec });
        expect(retired.superseded).toBe(true);
        expect((yield* table()).statusOf(retired)).toBe('open');
        expect((yield* graph.reading.show(newSpec, 0)).edgesOut.some((e) => e.kind === 'supersedes' && e.toId === oldSpec)).toBe(true);
        expect(yield* superseded(oldSpec)).toBe(true);
        expect((yield* refusal(graph.standing.supersede({ oldId: oldSpec, withId: newSpec }))).code).toBe('already-superseded');
      }),
    ),
  );

  it.effect('supersede answers with the sentences written against the retired block', () =>
    withLens(({ graph, projectId, spec, nameOf }) =>
      Effect.gen(function* () {
        const oldSpec = yield* spec('v1');
        const newSpec = yield* spec('v2');
        const oldName = yield* nameOf(oldSpec);
        const pointer = yield* graph.blocks.create({
          projectId,
          tags: ['idea'],
          title: 'built on the decision',
          body: `as decided in [[${oldName}]]`,
        });
        const trashed = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'also pointed', body: `and [[${oldName}]]` });
        yield* graph.trash.delete({ id: trashed.id });
        const answer = yield* graph.standing.supersede({ oldId: oldSpec, withId: newSpec });
        expect(answer.refsIn).toEqual([yield* nameOf(pointer.id)]);
      }),
    ),
  );

  it.effect('a replacement is withdrawn, and the block stands again as it stood', () =>
    withLens(({ graph, demoRoot, spec, superseded, refusal, table }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const oldSpec = yield* spec('v1');
        const newSpec = yield* spec('v2');
        yield* fs.writeFileString(join(demoRoot, 'withdrawn.ts'), 'export const withdrawn = 1;\n');
        yield* graph.sources.attach({ blockId: oldSpec, kind: 'file', ref: 'withdrawn.ts' });
        yield* graph.standing.supersede({ oldId: oldSpec, withId: newSpec });
        expect((yield* graph.standing.unsupersede({ id: oldSpec })).superseded).toBe(false);
        const read = yield* graph.reading.show(oldSpec, 0);
        expect(read.superseded).toBe(false);
        expect((yield* table()).statusOf(read)).toBe('open');
        expect(read.sources.map((row) => row.ref)).toEqual(['withdrawn.ts']);
        const successor = yield* graph.reading.show(newSpec, 0);
        expect(successor.superseded).toBe(false);
        expect(successor.edgesOut.some((e) => e.kind === 'supersedes')).toBe(false);
        const ops = (yield* graph.journal.events({ blockId: oldSpec })).map((entry) => entry.op);
        expect(ops.filter((op) => op === 'supersede' || op === 'unsupersede')).toEqual(['unsupersede', 'supersede']);
        expect((yield* refusal(graph.standing.unsupersede({ id: oldSpec }))).code).toBe('not-superseded');
        expect(yield* superseded(oldSpec)).toBe(false);
      }),
    ),
  );

  it.effect('withdrawing one retirement leaves the rest of the chain standing', () =>
    withLens(({ graph, chain, superseded }) =>
      Effect.gen(function* () {
        const { first, second, third } = yield* chain;
        yield* graph.standing.unsupersede({ id: first });
        expect(yield* superseded(first)).toBe(false);
        expect(yield* superseded(second)).toBe(true);
        expect(yield* superseded(third)).toBe(false);
      }),
    ),
  );

  it.effect('self-supersede is refused', () =>
    withLens(({ graph, spec, refusal }) =>
      Effect.gen(function* () {
        const id = yield* spec('spec');
        expect((yield* refusal(graph.standing.supersede({ oldId: id, withId: id }))).code).toBe('self-supersede');
      }),
    ),
  );

  it.effect('a chain of replacements is legal and keeps every link', () =>
    withLens(({ graph, chain, superseded }) =>
      Effect.gen(function* () {
        const { first, second, third } = yield* chain;
        expect(yield* superseded(first)).toBe(true);
        expect(yield* superseded(second)).toBe(true);
        expect(yield* superseded(third)).toBe(false);
        expect(yield* graph.standing.supersedesReaches(third, first)).toBe(true);
      }),
    ),
  );

  it.effect('a successor that was itself replaced is refused', () =>
    withLens(({ graph, spec, superseded, refusal }) =>
      Effect.gen(function* () {
        const old = yield* spec('old');
        const retired = yield* spec('retired');
        const head = yield* spec('head');
        yield* graph.standing.supersede({ oldId: retired, withId: head });
        expect((yield* refusal(graph.standing.supersede({ oldId: old, withId: retired }))).code).toBe('successor-superseded');
        expect(yield* superseded(old)).toBe(false);
      }),
    ),
  );

  it.effect('closing the chain into a ring is refused', () =>
    withLens(({ graph, chain, superseded, refusal }) =>
      Effect.gen(function* () {
        const { first, third } = yield* chain;
        expect((yield* refusal(graph.standing.supersede({ oldId: third, withId: first }))).code).toBe('successor-superseded');
        expect(yield* superseded(third)).toBe(false);
        expect(yield* graph.standing.supersedesReaches(third, first)).toBe(true);
        expect((yield* graph.reading.show(first, 0)).edgesOut.some((e) => e.kind === 'supersedes')).toBe(false);
      }),
    ),
  );

  it.effect('two successors for one block cannot both land', () =>
    withLens(({ graph, spec, refusal }) =>
      Effect.gen(function* () {
        const old = yield* spec('contested');
        const mine = yield* spec('mine');
        const theirs = yield* spec('theirs');
        yield* graph.standing.supersede({ oldId: old, withId: mine });
        expect((yield* refusal(graph.standing.supersede({ oldId: old, withId: theirs }))).code).toBe('already-superseded');
        const incoming = (yield* graph.reading.show(old, 0)).edgesIn.filter((e) => e.kind === 'supersedes');
        expect(incoming).toHaveLength(1);
      }),
    ),
  );
});
