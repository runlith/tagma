import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import { transactionUnit } from '../acts/state.js';
import { eq } from 'drizzle-orm';
import { block } from '../store/tables.js';
import { Blocks } from '../contract/service/blocks.js';
import { TRIGGERS } from '../testing/triggers.js';
import type { InstructionSet } from '../contract/wire/instructions.js';
import { instructionChanges } from './Instructions.js';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';

const rule = Effect.fnUntraced(function* (projectId: number, title: string, body: string, parentId?: number) {
  const blocks = yield* Blocks;
  return (yield* blocks.create({ projectId, tags: ['rule'], title, body, parentId: parentId ?? (yield* blocks.rootBlockOf(projectId)).id }))
    .id;
});

const lawOf = (set: InstructionSet) => set.entries.filter((entry) => entry.kind === 'law');

layer(demoGraphLayer(), { excludeTestServices: true })('instructions', (it) => {
  it.effect('instructions read committed law while a writer holds an uncommitted change', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const id = yield* rule(projectId, 'Standing law', 'Preserve records.');
        const name = yield* nameOf(id);
        const input = { projectId, audience: 'graph' as const };
        yield* graph.orientation.instructions(input);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const writer = yield* Effect.forkScoped(
          graph.act.unit(
            writes('test.law', [block]),
            Effect.gen(function* () {
              yield* graph.blocks.setEnabled({ id, enabled: false });
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }),
          ),
        );
        yield* Deferred.await(entered);
        const during = yield* graph.orientation.instructions(input).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        yield* Fiber.join(writer);
        expect(lawOf(during).map((entry) => entry.source)).toEqual([name]);
        expect(lawOf(yield* graph.orientation.instructions(input))).toEqual([]);
      }),
    ),
  );

  it.effect('law read inside a rolled-back act never replaces the committed instruction set', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const id = yield* rule(projectId, 'Standing law', 'Preserve records.');
        const input = { projectId, audience: 'graph' as const };
        const before = yield* graph.orientation.instructions(input);
        const cancelled = yield* Effect.result(
          graph.act.unit(
            writes('test.law', [block]),
            Effect.gen(function* () {
              yield* graph.blocks.setEnabled({ id, enabled: false });
              expect(lawOf(yield* graph.orientation.instructions(input))).toEqual([]);
              return yield* Effect.fail('cancelled');
            }),
          ),
        );
        expect(cancelled._tag).toBe('Failure');
        const after = yield* graph.orientation.instructions(input);
        expect(instructionChanges(after, before)).toMatchObject({ pending: [], withdrawn: [] });
        yield* graph.blocks.update({ id, body: 'Preserve records and provenance.' });
        const changed = yield* graph.orientation.instructions(input);
        expect(instructionChanges(changed, after).pending.map((entry) => entry.source)).toEqual([yield* nameOf(id)]);
      }),
    ),
  );

  it.effect('committed declaration changes are delivered before the writer finishes its publication hooks', () =>
    withDemo(({ graph, projectId, root }) =>
      Effect.gen(function* () {
        const declared = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['tag'],
          title: '#memo',
          body: 'Initial guidance.',
          fields: { id: 'memo' },
        });
        const input = { projectId, audience: 'graph' as const };
        const before = yield* graph.orientation.instructions(input);
        const committed = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const writer = yield* Effect.forkScoped(
          graph.act.unit(
            writes('test.declaration', [block]),
            Effect.gen(function* () {
              yield* graph.blocks.update({ id: declared.id, body: 'Changed guidance.' });
              yield* (yield* transactionUnit).afterCommit(
                Deferred.succeed(committed, undefined).pipe(Effect.andThen(Deferred.await(release))),
              );
            }),
          ),
        );
        yield* Deferred.await(committed);
        const during = yield* graph.orientation.instructions(input).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        yield* Fiber.join(writer);
        expect(instructionChanges(during, before).pending.map((entry) => entry.source)).toEqual(['#memo']);
        const prior = new Map(before.entries.map((entry) => [entry.source, entry.revision]));
        expect(during.entries.filter((entry) => prior.get(entry.source) !== entry.revision).map((entry) => entry.source)).toEqual([
          '#memo',
        ]);
        expect(during.complete).toBe(true);
        expect(instructionChanges(yield* graph.orientation.instructions(input), during).pending).toEqual([]);
      }),
    ),
  );

  it.effect('inspection changes leave the delivered norm and its revision unchanged', () =>
    withDemo(({ graph, projectId, nameOf }) =>
      Effect.gen(function* () {
        const id = yield* rule(projectId, 'Import only downward', 'Floors rank the server.');
        const name = yield* nameOf(id);
        const delivered = () =>
          Effect.map(graph.orientation.instructions({ projectId, audience: 'graph' }), (set) =>
            set.entries.find((entry) => entry.kind === 'law' && entry.source === name),
          );
        const plain = yield* delivered();
        const { db } = graph.graphStore;
        const row = yield* db.select({ fields: block.fields }).from(block).where(eq(block.id, id)).get();
        for (const inspection of ['direction', 'direction-harness']) {
          yield* db
            .update(block)
            .set({
              fields: {
                ...row?.fields,
                enforcement: {
                  strictness: 'gate',
                  on: TRIGGERS.landing,
                  inspection,
                  debt: [],
                  escaped: [],
                },
              },
            })
            .where(eq(block.id, id));
          const gated = yield* delivered();
          expect(gated?.text).toBe(plain!.text);
          expect(gated?.revision).toBe(plain!.revision);
        }
      }),
    ),
  );

  it.effect('an unreadable declaration is named while readable types and law remain delivered', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const everywhere = yield* rule(projectId, 'Bun only', 'No node.');
        const memo = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['tag'],
          title: '#memo',
          body: 'A memo.',
          fields: { id: 'memo' },
        });
        yield* graph.graphStore.db
          .update(block)
          .set({ fields: { id: 'memo', roles: { retired: true } } })
          .where(eq(block.id, memo.id));
        yield* graph.tags.forget(projectId);
        const set = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
        const name = yield* nameOf(memo.id);
        expect(set.entries.find((entry) => entry.source === name)?.text).toContain('#memo');
        expect(set.entries.some((entry) => entry.kind === 'tag' && entry.source === '#idea')).toBe(true);
        expect(lawOf(set).map((entry) => entry.source)).toEqual([yield* nameOf(everywhere)]);
      }),
    ),
  );

  it.effect('the instruction set holds every prompt rule wherever it stands, and delivery moves a sourced rule in and out', () =>
    withDemo(({ graph, projectId, nameOf, root }) =>
      Effect.gen(function* () {
        const area = yield* graph.blocks.create({ projectId, parentId: root, tags: ['zone'], title: 'product' });
        const deep = yield* rule(projectId, 'Zone law', 'This zone speaks one way.', area.id);
        const coded = yield* graph.blocks.create({
          projectId,
          parentId: root,
          tags: ['rule'],
          title: 'Source law',
          body: 'Only under src.',
          sources: [{ kind: 'dir', ref: 'src' }],
        });
        const law = () => graph.orientation.instructions({ projectId, audience: 'graph' });
        const coding = yield* law();
        expect(lawOf(coding).map((entry) => entry.source)).toEqual([yield* nameOf(deep)]);
        yield* graph.blocks.setDelivery({ id: coded.id, delivery: 'prompt' });
        const prompted = yield* law();
        expect(lawOf(prompted).map((entry) => entry.source)).toEqual([yield* nameOf(deep), yield* nameOf(coded.id)]);
        expect((yield* graph.sources.of(coded.id)).map((row) => row.ref)).toEqual(['src']);
        yield* graph.blocks.setDelivery({ id: coded.id, delivery: null });
        expect(instructionChanges(yield* law(), prompted).withdrawn.map((entry) => entry.source)).toEqual([yield* nameOf(coded.id)]);
      }),
    ),
  );
});
