import { Effect } from 'effect';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';
import { SHIPPED_CATALOGS } from '../../composition/testing/settings.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';

const TICKET_GATES = [
  { gate: 'transition', field: 'state', from: 'queued', to: 'taken' },
  { gate: 'transition', field: 'state', from: 'taken', to: 'queued' },
  { gate: 'transition', field: 'state', from: 'taken', to: 'shipped' },
  { gate: 'transition', field: 'state', from: 'taken', to: 'dropped' },
] as const;

const TICKET_ROLES = {
  status: { field: 'state', initial: 'queued', claimed: 'taken', done: 'shipped', closed: 'dropped' },
  holder: 'owner',
  work: true,
} as const;

const ticketDeclaration = (id: string, words: readonly string[]) => ({
  id,
  fields: { state: { type: 'enum', values: [...words] }, owner: 'session' },
  roles: TICKET_ROLES,
  gates: TICKET_GATES.map((gate) => ({ ...gate })),
});

const lens = ({ graph, projectId, root }: EffectDemo) => {
  const declare = (fields: Record<string, unknown>) =>
    graph.blocks.create({ projectId, parentId: root, tags: ['tag'], title: `#${fields.id as string}`, body: 'declared here', fields });
  const born = (tags: string[], title: string) => graph.blocks.create({ projectId, parentId: root, tags, title });
  return { declare, born };
};

const withLens = <A, E, R>(body: (given: EffectDemo & ReturnType<typeof lens>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => body({ ...demo, ...lens(demo) }));

layer(demoGraphLayer(), { excludeTestServices: true })('status binding', (it) => {
  it.effect('a declared tag claims, finishes and rests by the words it NAMES, and reversing its enum changes nothing', () =>
    withLens(({ graph, declare, born, as }) =>
      Effect.gen(function* () {
        yield* declare(ticketDeclaration('ticket', ['queued', 'taken', 'shipped', 'dropped']));
        yield* declare(ticketDeclaration('reversed', ['dropped', 'shipped', 'taken', 'queued']));
        for (const tag of ['ticket', 'reversed']) {
          const node = yield* born([tag], `a ${tag}`);
          expect(node.fields.state).toBe('queued');
          expect((yield* as('holder', graph.tasks.claim({ id: node.id }))).fields.state).toBe('taken');
          expect((yield* as('holder', graph.tasks.finish({ id: node.id }))).fields.state).toBe('shipped');
          const dropped = yield* born([tag], `another ${tag}`);
          yield* as('holder', graph.tasks.claim({ id: dropped.id }));
          const closed = yield* as('holder', graph.tasks.close({ id: dropped.id, reason: 'not ours' }));
          expect(closed.fields.state).toBe('dropped');
        }
      }),
    ),
  );

  it.effect('one tag ending at a word another merely passes through: ready and the outline answer per tag', () =>
    withLens(({ graph, projectId, declare, born, as }) =>
      Effect.gen(function* () {
        yield* declare({
          id: 'stage',
          fields: { state: { type: 'enum', values: ['open', 'done', 'archived', 'abandoned'] }, owner: 'session' },
          roles: {
            status: { field: 'state', initial: 'open', claimed: 'done', done: 'archived', closed: 'abandoned' },
            holder: 'owner',
            work: true,
          },
          gates: [
            { gate: 'transition', field: 'state', from: 'open', to: 'done' },
            { gate: 'transition', field: 'state', from: 'done', to: 'open' },
            { gate: 'transition', field: 'state', from: 'done', to: 'archived' },
            { gate: 'transition', field: 'state', from: 'open', to: 'abandoned' },
          ],
        });
        const finished = yield* born(['task'], 'a finished task');
        yield* graph.tasks.finish({ id: finished.id });
        const running = yield* born(['stage'], 'a running stage');
        yield* as('holder', graph.tasks.claim({ id: running.id }));
        expect((yield* graph.blocks.blockById(running.id)).fields.state).toBe('done');
        const ready = (yield* graph.selection.ready({ projectId })).map((row) => row.title);
        expect(ready).not.toContain('a finished task');
        expect(ready).not.toContain('a running stage');
        const sort = { by: 'created', order: 'asc' } as const;
        const standing = (yield* graph.selection.query(projectId, { tags: ['task', 'stage'], sort })).items.map((row) => row.title);
        expect(standing).toEqual(['a running stage']);
        const archived = yield* as('holder', graph.tasks.finish({ id: running.id }));
        expect(archived.fields.state).toBe('archived');
        expect((yield* graph.selection.query(projectId, { tags: ['stage'], sort })).items).toEqual([]);
      }),
    ),
  );

  it.effect('a word a verb owns is refused to a plain update, naming the verb that owns it on THIS tag', () =>
    withLens(({ graph, declare, born, as, refusal }) =>
      Effect.gen(function* () {
        yield* declare(ticketDeclaration('ticket', ['queued', 'taken', 'shipped', 'dropped']));
        const ticket = yield* born(['ticket'], 'the latch');
        yield* as('holder', graph.tasks.claim({ id: ticket.id }));
        const released = yield* refusal(graph.blocks.update({ id: ticket.id, status: 'queued' }));
        expect(released.code).toBe('status-operation');
        expect(released.unblock.join(' ')).toContain('release_block');
        const other = yield* born(['ticket'], 'the hinge');
        const taken = yield* refusal(graph.blocks.update({ id: other.id, status: 'taken' }));
        expect(taken.code).toBe('status-operation');
        expect(taken.unblock.join(' ')).toContain('claim_block');
        expect((yield* graph.blocks.blockById(ticket.id)).fields.state).toBe('taken');
        expect((yield* graph.blocks.blockById(other.id)).fields.state).toBe('queued');
      }),
    ),
  );

  it.effect(
    'a move an action declares belongs to its operation, and every other move — an intermediate word, a reopen — is an update',
    () =>
      withLens(({ graph, declare, born, as, nameOf, refusal, table }) =>
        Effect.gen(function* () {
          yield* declare({
            id: 'job',
            fields: { state: { type: 'enum', values: ['queued', 'taken', 'review', 'shipped', 'dropped'] }, owner: 'session' },
            roles: TICKET_ROLES,
            gates: [
              ...TICKET_GATES.map((gate) => ({ ...gate })),
              { gate: 'transition', field: 'state', from: 'taken', to: 'review' },
              { gate: 'transition', field: 'state', from: 'review', to: 'shipped' },
              { gate: 'transition', field: 'state', from: 'review', to: 'queued' },
              { gate: 'transition', field: 'state', from: 'shipped', to: 'queued' },
            ],
          });
          const chores = {
            fields: { state: { type: 'enum', values: ['open', 'busy', 'done', 'dropped'] }, owner: 'session' },
            gates: [
              { gate: 'transition', field: 'state', from: 'open', to: 'busy' },
              { gate: 'transition', field: 'state', from: 'busy', to: 'open' },
              { gate: 'transition', field: 'state', from: 'busy', to: 'done' },
              { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
            ],
          };
          yield* declare({
            id: 'chore',
            ...chores,
            roles: { status: { field: 'state', initial: 'open', claimed: 'busy', done: 'done', closed: 'dropped' }, work: true },
          });
          yield* declare({
            id: 'errand',
            ...chores,
            roles: { status: { field: 'state', initial: 'open', done: 'done', closed: 'dropped' }, holder: 'owner', work: true },
          });
          const job = yield* born(['job'], 'a job');
          expect((yield* refusal(graph.blocks.update({ id: job.id, status: 'shipped' }))).code).toBe('status-operation');
          expect((yield* refusal(graph.blocks.update({ id: job.id, fields: { owner: 1 } }))).code).toBe('operation-only');
          const taken = yield* as('holder', graph.tasks.claim({ id: job.id }));
          expect(taken.fields.state).toBe('taken');
          expect((yield* table()).holderOf(taken)).not.toBeNull();
          expect((yield* graph.blocks.update({ id: job.id, status: 'review' })).fields.state).toBe('review');
          const kept = yield* refusal(graph.blocks.update({ id: job.id, status: 'queued' }));
          expect(kept.code).toBe('status-operation');
          expect(kept.unblock[0]).toBe(`release_block on ${yield* nameOf(job.id)}`);
          yield* as('holder', graph.tasks.finish({ id: job.id }));
          expect((yield* graph.blocks.update({ id: job.id, status: 'queued' })).fields.state).toBe('queued');
          for (const tag of ['chore', 'errand']) {
            const unheld = yield* born([tag], `a ${tag}`);
            expect((yield* graph.blocks.update({ id: unheld.id, status: 'busy' })).fields.state).toBe('busy');
            expect((yield* graph.blocks.update({ id: unheld.id, status: 'open' })).fields.state).toBe('open');
          }
          yield* declare({ id: 'stamp', fields: { owner: 'session' }, roles: { holder: 'owner' } });
          const stamped = yield* born(['chore', 'stamp'], 'a held chore');
          const claimed = yield* refusal(graph.blocks.update({ id: stamped.id, status: 'busy' }));
          expect(claimed.code).toBe('status-operation');
          expect(claimed.unblock[0]).toBe(`claim_block on ${yield* nameOf(stamped.id)}`);
          const { moves, slots } = (yield* table()).actionsOf('job');
          expect(moves).toContainEqual(expect.objectContaining({ field: 'state', to: 'taken', op: 'claim_block', from: undefined }));
          expect(moves).toContainEqual(
            expect.objectContaining({ field: 'state', to: 'queued', op: 'release_block', from: ['taken', 'review'] }),
          );
          expect(moves.map((move) => move.to)).not.toContain('review');
          expect(slots).toEqual([{ field: 'owner', ops: ['claim_block', 'release_block'] }]);
        }),
      ),
  );

  it.effect('a node carrying two tags is worked through the tag that owns the role, and two status bindings refuse', () =>
    withLens(({ graph, projectId, declare, born, as, refusal, table, root }) =>
      Effect.gen(function* () {
        yield* graph.settings.write({
          scope: 'project',
          projectId,
          key: SHIPPED_CATALOGS.key.id,
          value: ['software-development', 'knowledge'],
        });
        const both = yield* born(['decision', 'task'], 'implement an accepted choice');
        expect(both.tags).toEqual(['decision', 'task']);
        const tags = yield* table();
        expect(tags.tagOf(both)?.id).toBe('decision');
        expect(tags.bindingTag(both, LIFECYCLE)?.id).toBe('task');
        expect((yield* as('holder', graph.tasks.claim({ id: both.id }))).fields.status).toBe('in_work');
        expect((yield* as('holder', graph.tasks.finish({ id: both.id }))).fields.status).toBe('done');
        yield* declare({
          id: 'errand',
          fields: { state: { type: 'enum', values: ['open', 'done', 'dropped'] } },
          roles: { status: { field: 'state', initial: 'open', done: 'done', closed: 'dropped' } },
          gates: [
            { gate: 'transition', field: 'state', from: 'open', to: 'done' },
            { gate: 'transition', field: 'state', from: 'open', to: 'dropped' },
          ],
        });
        const clash = yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['task', 'errand'], title: 'both at once' }));
        expect(clash.code).toBe('role-conflict');
        expect(clash.reason).toContain('status');
        yield* declare({ id: 'batch', fields: { status: 'number' } });
        const fields = yield* refusal(graph.blocks.create({ projectId, parentId: root, tags: ['task', 'batch'], title: 'both again' }));
        expect(fields.code).toBe('field-conflict');
        expect(fields.reason).toContain('status');
      }),
    ),
  );
});
