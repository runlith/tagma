import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../../composition/testing/graphFixture.js';
import { signedBy } from '../../../invocation/testing/call.js';
import { NATIVE_HARNESS } from '../../../platform/contract/wire/session.js';
import { HolderStandings } from '../../contract/service/holders.js';
import type { HolderState } from '../../contract/wire/holders.js';

const STATES: ReadonlyMap<string, HolderState> = new Map([
  ['child-gone', { standing: 'gone', child: true }],
  ['child-rested', { standing: 'rested', child: true }],
  ['child-working', { standing: 'working', child: true }],
  ['root-rested', { standing: 'rested', child: false }],
]);

layer(demoGraphLayer(), { excludeTestServices: true })('task holders', (it) => {
  it.effect(
    'work of a child that stopped or a thread that is gone is held by nobody, stands idle, and leaves the orientation; a working child and a rested root keep theirs',
    () =>
      withDemo(({ graph, context, projectId, as, nameOf }) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              Context.get(context, HolderStandings).serve((ids) =>
                Effect.succeed(new Map(ids.flatMap((id) => (STATES.has(id) ? [[id, STATES.get(id)!] as const] : [])))),
              ),
            ),
            (stop) => Effect.sync(stop),
          );
          const names = new Map<string, string>();
          for (const key of STATES.keys()) {
            const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: `held by ${key}` });
            yield* signedBy({ harness: NATIVE_HARNESS, key })(graph.tasks.claim({ id }));
            names.set(key, yield* nameOf(id));
          }
          const asked = Effect.fnUntraced(function* (key: string) {
            const row = yield* graph.blocks.blockById(yield* graph.blockNames.idOfName(names.get(key)!));
            return yield* as('reader', graph.tasks.heldElsewhere(row));
          });
          expect(yield* asked('child-gone')).toBeNull();
          expect(yield* asked('child-rested')).toBeNull();
          expect(yield* asked('child-working')).toMatchObject({ name: names.get('child-working') });
          expect(yield* asked('root-rested')).toMatchObject({ name: names.get('root-rested') });

          const idle = yield* graph.tasks.idle({ projectId });
          expect(
            new Map(
              yield* Effect.forEach(idle, (one) => Effect.map(nameOf(one.id), (name) => [name, [one.holder.key, one.standing]] as const)),
            ),
          ).toEqual(
            new Map([
              [names.get('child-gone')!, ['child-gone', 'gone']],
              [names.get('child-rested')!, ['child-rested', 'rested']],
            ]),
          );

          const prime = yield* graph.orientation.render({ projectId });
          expect(prime).toContain(names.get('child-working')!);
          expect(prime).toContain(names.get('root-rested')!);
          expect(prime).not.toContain(names.get('child-gone')!);
          expect(prime).not.toContain(names.get('child-rested')!);
          expect(prime).toContain('2 more in work by sessions that stopped working');
        }),
      ),
  );

  it.effect('a holder that stopped hands what it holds to the session named, or back to open, and names the open work it filed', () =>
    withDemo(({ graph, projectId, nameOf, table }) =>
      Effect.gen(function* () {
        const tags = yield* table();
        const child = { harness: NATIVE_HARNESS, key: 'stopped-child' };
        const parent = { harness: NATIVE_HARNESS, key: 'its-parent' };
        const held = yield* signedBy(child)(graph.blocks.create({ projectId, tags: ['task'], title: 'held by the child' }));
        yield* signedBy(child)(graph.tasks.claim({ id: held.id }));
        const filed = yield* signedBy(child)(graph.blocks.create({ projectId, tags: ['task'], title: 'filed by the child' }));

        const named = { name: yield* nameOf(held.id), title: 'held by the child' };
        expect(yield* graph.tasks.holdings({ projectId, from: child })).toEqual({
          held: [named],
          filed: [{ name: yield* nameOf(filed.id), title: 'filed by the child' }],
        });
        expect(yield* graph.tasks.handOver({ projectId, from: child, to: parent })).toEqual([named]);
        expect(yield* graph.tasks.handOver({ projectId, from: child, to: parent })).toEqual([]);
        const taken = yield* graph.blocks.blockById(held.id);
        expect(tags.statusOf(taken)).toBe('in_work');
        expect(yield* signedBy(parent)(graph.tasks.heldElsewhere(taken))).toBeNull();
        expect(yield* signedBy(child)(graph.tasks.heldElsewhere(taken))).toMatchObject({ name: yield* nameOf(held.id) });

        const other = { harness: NATIVE_HARNESS, key: 'another-taker' };
        const moved = yield* signedBy(child)(graph.blocks.create({ projectId, tags: ['task'], title: 'taken on by another' }));
        yield* signedBy(child)(graph.tasks.claim({ id: moved.id }));
        yield* signedBy(other)(graph.tasks.claim({ id: moved.id }));
        expect(yield* graph.tasks.handOver({ projectId, from: child, to: parent })).toEqual([]);
        expect(yield* signedBy(other)(graph.tasks.heldElsewhere(yield* graph.blocks.blockById(moved.id)))).toBeNull();

        const root = { harness: NATIVE_HARNESS, key: 'root-put-away' };
        const left = yield* signedBy(root)(graph.blocks.create({ projectId, tags: ['task'], title: 'held by a root put away' }));
        yield* signedBy(root)(graph.tasks.claim({ id: left.id }));
        expect(yield* graph.tasks.handOver({ projectId, from: root, to: null })).toEqual([
          { name: yield* nameOf(left.id), title: 'held by a root put away' },
        ]);
        const opened = yield* graph.blocks.blockById(left.id);
        expect(tags.statusOf(opened)).toBe('open');
        expect(tags.holderOf(opened)).toBeNull();
      }),
    ),
  );
});
