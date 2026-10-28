import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { event } from '../../store/tables.js';
import { type AmendmentOp, batchDocument } from '../../contract/wire/batch.js';
import { blockName } from '../../contract/wire/references.js';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../../composition/testing/graphFixture.js';

const lens = (demo: EffectDemo) => {
  const { graph, projectId, nameOf, root } = demo;
  const held = (id: number) => Effect.map(nameOf(id), (name) => ({ id, name }));
  const create = (tag: string, title: string, body?: string) =>
    Effect.flatMap(graph.blocks.create({ projectId, parentId: root, tags: [tag], title, body }), (row) => held(row.id));
  const propose = (amendsId: number, ops: AmendmentOp[], title = 'amendment') =>
    Effect.flatMap(graph.review.propose({ projectId, title, amendsId, ops }), (row) => held(row.id));
  const entryOf = (blockId: number, op: string) =>
    Effect.map(graph.journal.events({ blockId }), (entries) => entries.find((entry) => entry.op === op));
  return { ...demo, create, propose, entryOf };
};

const withLens = <A, E, R>(body: (given: ReturnType<typeof lens>) => Effect.Effect<A, E, R>) => withDemo((demo) => body(lens(demo)));

layer(demoGraphLayer(), { excludeTestServices: true })('proposal verdicts', (it) => {
  it.effect('accept executes the deferred ops and closes as applied in one commit', () =>
    withLens(({ graph, create, propose, entryOf, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'reviewed', 'old wording here');
        const proposal = yield* propose(target.id, [
          { op: 'edit', id: target.name, old: 'old wording', new: 'new wording' },
          { op: 'create', $id: 'child', title: 'missing piece', parentId: target.name },
        ]);
        expect((yield* table()).statusOf(yield* graph.review.accept({ id: proposal.id }))).toBe('applied');
        expect((yield* graph.blocks.blockById(target.id)).body).toBe('new wording here');
        const [piece] = (yield* graph.blocks.childrenOf(target.id)).filter((c) => c.title === 'missing piece');
        if (!piece) return yield* Effect.die('the deferred create did not land');
        const shown = yield* graph.reading.show(piece.id, 0);
        expect(shown.edgesOut.some((e) => e.kind === 'discovered-from' && blockName(e.toUuid ?? '') === proposal.name)).toBe(true);
        const entry = yield* entryOf(proposal.id, 'accept');
        expect(JSON.parse(entry?.payload ?? '{}').created).toEqual([piece.id]);
      }),
    ),
  );

  it.effect('a created node deleted later in the accepted payload retains its discovery when restored', () =>
    withLens(({ graph, create, propose, entryOf, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'spec');
        const proposal = yield* propose(target.id, [
          { op: 'create', $id: 'temporary', title: 'temporary', parentId: target.name },
          { op: 'delete', id: '$temporary' },
        ]);
        expect((yield* table()).statusOf(yield* graph.review.accept({ id: proposal.id }))).toBe('applied');
        const entry = yield* entryOf(proposal.id, 'accept');
        const id: number = JSON.parse(entry?.payload ?? '{}').created[0];
        expect((yield* graph.blocks.rawBlockById(id)).deletedAt).not.toBeNull();
        yield* graph.trash.restore({ id });
        expect((yield* graph.reading.show(id, 0)).edgesOut.map((edge) => [edge.kind, edge.toId])).toEqual([
          ['discovered-from', proposal.id],
        ]);
      }),
    ),
  );

  it.effect('a stale anchor refuses the whole accept and leaves the proposal open', () =>
    withLens(({ graph, create, propose, refusal, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'moving', 'reviewed text');
        const proposal = yield* propose(target.id, [
          { op: 'create', tags: ['spec'], title: 'lands first', parentId: target.name },
          { op: 'edit', id: target.name, old: 'reviewed text', new: 'amended text' },
        ]);
        yield* graph.blocks.edit({ id: target.id, old: 'reviewed text', new: 'rewritten meanwhile' });
        expect((yield* refusal(graph.review.accept({ id: proposal.id }))).code).toBe('anchor-not-found');
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(proposal.id))).toBe('open');
        expect((yield* graph.blocks.blockById(target.id)).body).toBe('rewritten meanwhile');
        expect((yield* graph.blocks.childrenOf(target.id)).map((c) => c.title)).not.toContain('lands first');
      }),
    ),
  );

  it.effect('the scope gate runs again at accept', () =>
    withLens(({ graph, projectId, create, propose, nameOf, refusal, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'shrinking');
        const child = yield* graph.blocks.create({ projectId, tags: ['spec'], title: 'child', parentId: target.id, body: 'text' });
        const proposal = yield* propose(target.id, [{ op: 'edit', id: yield* nameOf(child.id), old: 'text', new: 'other' }]);
        const elsewhere = yield* create('zone', 'away');
        yield* graph.blocks.update({ id: child.id, parentId: elsewhere.id });
        expect((yield* refusal(graph.review.accept({ id: proposal.id }))).code).toBe('amendment-outside');
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(proposal.id))).toBe('open');
      }),
    ),
  );

  it.effect('verdicts are operations and final', () =>
    withLens(({ graph, create, propose, refusal, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 't', 'v');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'v', new: 'w' }]);
        expect((yield* refusal(graph.blocks.update({ id: proposal.id, status: 'applied' }))).code).toBe('status-operation');
        expect((yield* refusal(graph.blocks.update({ id: proposal.id, status: 'rejected' }))).code).toBe('status-operation');
        const generic = yield* refusal(graph.tasks.close({ id: proposal.id, reason: 'no' }));
        expect(generic.code).toBe('status-operation');
        expect(generic.unblock.join(' ')).toContain('reject_amendment');
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(proposal.id))).toBe('open');
        yield* graph.review.accept({ id: proposal.id });
        expect((yield* refusal(graph.review.accept({ id: proposal.id }))).code).toBe('illegal-transition');
        expect((yield* refusal(graph.review.reject({ id: proposal.id }))).code).toBe('illegal-transition');
        expect((yield* refusal(graph.review.accept({ id: target.id }))).code).toBe('not-an-amendment');
      }),
    ),
  );

  it.effect('reject buries the payload untouched and carries its reason; a blank reason refuses', () =>
    withLens(({ graph, create, propose, refusal, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const target = yield* create('spec', 't', 'stays');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'stays', new: 'would change' }]);
        expect((yield* refusal(graph.review.reject({ id: proposal.id }))).code).toBe('reason-required');
        expect((yield* refusal(graph.review.reject({ id: proposal.id, reason: '  ' }))).code).toBe('reason-required');
        expect(tags.statusOf(yield* graph.blocks.blockById(proposal.id))).toBe('open');
        expect((yield* graph.reading.show(proposal.id, 0)).verdict).toBeNull();
        const rejected = yield* graph.review.reject({ id: proposal.id, reason: 'does not reproduce: the guard at the door covers it' });
        expect(tags.statusOf(rejected)).toBe('rejected');
        expect((yield* graph.blocks.blockById(target.id)).body).toBe('stays');
        const verdict = (yield* graph.reading.show(proposal.id, 0)).verdict;
        expect(verdict?.status).toBe('rejected');
        expect(verdict?.writer).toBeNull();
        expect(verdict?.reason).toBe('does not reproduce: the guard at the door covers it');
      }),
    ),
  );

  it.effect('a decided proposal with no verdict entry reads as a verdict nobody recorded', () =>
    withLens(({ graph, create, propose, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 't', 'stays');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'stays', new: 'x' }]);
        yield* graph.review.reject({ id: proposal.id, reason: 'declined' });
        yield* graph.graphStore.db.delete(event).where(and(eq(event.blockId, proposal.id), eq(event.op, 'reject')));
        const read = yield* graph.reading.show(proposal.id, 0);
        expect((yield* table()).statusOf(read)).toBe('rejected');
        expect(read.verdict).toBeNull();
        expect((yield* graph.reading.show(target.id, 3)).body).toBe('stays');
      }),
    ),
  );

  it.effect('uphold agrees, runs nothing, and names what already answers the finding', () =>
    withLens(({ graph, projectId, create, propose, entryOf, nameOf, refusal, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const target = yield* create('spec', 't', 'the wording that stands');
        const answer = yield* create('task', 'fixed it in this change');
        const proposal = yield* propose(target.id, [
          { op: 'edit', id: target.name, old: 'the wording that stands', new: 'a rewording' },
          { op: 'create', tags: ['task'], title: 'never lands', parentId: target.name },
        ]);
        const uphold = (input: { reason?: string; by: number[] }) =>
          Effect.map(refusal(graph.review.uphold({ id: proposal.id, ...input })), (refused) => refused.code);
        expect(yield* uphold({ by: [answer.id] })).toBe('reason-required');
        expect(yield* uphold({ reason: ' ', by: [answer.id] })).toBe('reason-required');
        expect(yield* uphold({ reason: 'taken', by: [proposal.id] })).toBe('self-answer');
        expect((yield* refusal(graph.blocks.update({ id: proposal.id, status: 'upheld' }))).code).toBe('status-operation');
        expect(tags.statusOf(yield* graph.blocks.blockById(proposal.id))).toBe('open');
        const upheld = yield* graph.review.uphold({
          id: proposal.id,
          reason: 'the sentence was corrected in this change',
          by: [answer.id],
        });
        expect(tags.statusOf(upheld)).toBe('upheld');
        expect((yield* graph.blocks.blockById(target.id)).body).toBe('the wording that stands');
        expect((yield* graph.blocks.childrenOf(target.id)).map((c) => c.title)).not.toContain('never lands');
        const verdict = (yield* graph.reading.show(proposal.id, 0)).verdict;
        expect(verdict?.status).toBe('upheld');
        expect(verdict?.reason).toBe('the sentence was corrected in this change');
        expect(verdict?.by).toEqual([yield* nameOf(answer.id)]);
        expect(JSON.parse((yield* entryOf(proposal.id, 'uphold'))?.payload ?? '{}').by).toEqual([answer.id]);
        expect((yield* refusal(graph.review.accept({ id: proposal.id }))).code).toBe('illegal-transition');
        expect(yield* uphold({ reason: 'again', by: [answer.id] })).toBe('illegal-transition');
        expect((yield* refusal(graph.review.uphold({ id: target.id, reason: 'r', by: [answer.id] }))).code).toBe('not-an-amendment');
        expect((yield* graph.review.proposals({ projectId, decided: true })).map((row) => row.id)).toEqual([proposal.id]);
        expect(yield* graph.review.proposals({ projectId })).toEqual([]);
      }),
    ),
  );

  it.effect('the batch signs the third verdict, and an upheld proposal leaves the outline', () =>
    withLens(({ graph, projectId, create, propose, table }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 't', 'stands');
        const derived = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'stands', new: 'merged' }], 'derived');
        const source = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'stands', new: 'source' }], 'source');
        yield* graph.batch.apply(
          batchDocument([{ op: 'uphold', id: source.name, reason: 'merged into the derived finding', by: [derived.name] }]),
          projectId,
        );
        expect((yield* table()).statusOf(yield* graph.blocks.blockById(source.id))).toBe('upheld');
        expect((yield* graph.reading.show(source.id, 0)).verdict?.by).toEqual([derived.name]);
        const outline = (yield* graph.reading.show(target.id, 1)).children.map((child) => child.title);
        expect(outline).toContain('derived');
        expect(outline).not.toContain('source');
      }),
    ),
  );

  it.effect('accept takes an optional reason, through the batch too', () =>
    withLens(({ graph, projectId, create, propose }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 't', 'v');
        const proposal = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'v', new: 'w' }]);
        yield* graph.batch.apply(batchDocument([{ op: 'accept', id: proposal.name, reason: '2 of 3 judges' }]), projectId);
        expect((yield* graph.reading.show(proposal.id, 0)).verdict).toMatchObject({ status: 'applied', reason: '2 of 3 judges' });
        const other = yield* propose(target.id, [{ op: 'edit', id: target.name, old: 'w', new: 'x' }]);
        yield* graph.review.accept({ id: other.id });
        expect((yield* graph.reading.show(other.id, 0)).verdict).toMatchObject({ status: 'applied', reason: null });
      }),
    ),
  );

  it.effect('payload handles wire deferred creates together at accept', () =>
    withLens(({ graph, create, propose, nameOf }) =>
      Effect.gen(function* () {
        const target = yield* create('spec', 'grows');
        const proposal = yield* propose(target.id, [
          { op: 'create', $id: 'x', tags: ['spec'], title: 'x', parentId: target.name },
          {
            op: 'create',
            tags: ['task'],
            title: 'builds x',
            parentId: target.name,
            edges: [
              { kind: 'implements', to: '$x' },
              { kind: 'relates', to: '$x' },
              { kind: 'discovered-from', to: '$x' },
            ],
          },
        ]);
        yield* graph.review.accept({ id: proposal.id });
        const children = yield* graph.blocks.childrenOf(target.id);
        const [x] = children.filter((c) => c.title === 'x');
        const [builder] = children.filter((c) => c.title === 'builds x');
        if (!x || !builder) return yield* Effect.die('deferred creates did not land');
        const xName = yield* nameOf(x.id);
        const edges = (yield* graph.reading.show(builder.id, 0)).edgesOut;
        expect(
          edges
            .filter((edge) => blockName(edge.toUuid ?? '') === xName)
            .map((edge) => edge.kind)
            .sort(),
        ).toEqual(['discovered-from', 'implements', 'relates']);
      }),
    ),
  );
});
