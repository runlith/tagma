import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { type SessionRef, sessionName } from '../../../../platform/contract/wire/session.js';
import { sessionIdentity } from '../../../../external-harnesses/sessionPrefix.js';
import { batchDocument } from '../../../../graph/contract/wire/batch.js';
import { demoGraphLayer, withDemo } from '../../graphFixture.js';
import { signedBy } from '../../../../invocation/testing/call.js';

const A: SessionRef = { harness: 'claude-code', key: 'session-a' };
const B: SessionRef = { harness: 'claude-code', key: 'session-b' };

layer(demoGraphLayer())('journal sessions', (it) => {
  it.effect('first writes register distinct sessions, stamp their events and expose the newest writer first', () =>
    withDemo(({ graph, projectId }) =>
      Effect.gen(function* () {
        const created = yield* signedBy(A)(graph.blocks.create({ projectId, tags: ['idea'], title: 'First' }));
        const [entry] = yield* graph.journal.events({ blockId: created.id, limit: 1 });
        if (entry?.sessionId == null) return yield* Effect.die('the first signed write has no session');
        const row = yield* graph.sessions.byId(entry.sessionId);
        expect(row).toMatchObject(A);
        expect(yield* graph.sessions.idOf(A)).toBe(entry.sessionId);
        const again = yield* signedBy(A)(graph.blocks.create({ projectId, tags: ['idea'], title: 'Again' }));
        expect((yield* graph.journal.events({ blockId: again.id, limit: 1 }))[0]?.sessionId).toBe(entry.sessionId);
        const other = yield* signedBy(B)(graph.blocks.create({ projectId, tags: ['idea'], title: 'Other' }));
        const [different] = yield* graph.journal.events({ blockId: other.id, limit: 1 });
        if (different?.sessionId == null) return yield* Effect.die('the other signed write has no session');
        expect(different.sessionId).not.toBe(entry.sessionId);
        const unsigned = yield* graph.blocks.create({ projectId, tags: ['idea'], title: 'No session' });
        expect((yield* graph.journal.events({ blockId: unsigned.id, limit: 1 }))[0]?.sessionId).toBeNull();
        const vocabulary = yield* graph.journal.vocabulary({ projectId });
        expect(vocabulary.sessions.map(({ id, harness, key }) => ({ id, harness, key }))).toEqual([
          { id: different.sessionId, ...B },
          { id: entry.sessionId, ...A },
        ]);
        expect((yield* graph.journal.events({ projectId, sessions: [entry.sessionId], limit: 3 })).map(({ blockId }) => blockId)).toEqual([
          again.id,
          created.id,
        ]);
      }),
    ),
  );

  it.effect('a rolled-back batch registers neither its writer nor its first entry', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const before = yield* graph.journal.events({ projectId });
        const refusal = yield* demo.refusal(
          signedBy(A)(
            graph.batch.apply(
              batchDocument([
                { op: 'create', $id: 'a', tags: ['idea'], title: 'Lands' },
                { op: 'edit', id: '$a', old: 'nothing like this', new: 'x' },
              ]),
              projectId,
            ),
          ),
        );
        expect(refusal.code).toBe('anchor-not-found');
        expect(yield* graph.sessions.idOf(A)).toBeNull();
        expect(yield* graph.journal.events({ projectId })).toEqual(before);
      }),
    ),
  );

  it.effect('operator and session claims are idempotent, touches follow their holder and another session can take over', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const { graph, projectId } = demo;
        const { id } = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Work' });
        const table = yield* demo.table();
        yield* graph.tasks.claim({ id });
        expect(table.holderOf(yield* graph.tasks.claim({ id }))).toBeNull();
        const held = yield* signedBy(A)(graph.tasks.claim({ id }));
        expect(table.holderOf(held)).toBe(yield* graph.sessions.idOf(A));
        expect(table.holderOf(yield* signedBy(A)(graph.tasks.claim({ id })))).toBe(table.holderOf(held));
        const holder = yield* graph.sessions.byId(table.holderOf(held)!);
        if (holder === undefined) return yield* Effect.die('the claimed task has no registered holder');
        const seen = yield* signedBy(B)(graph.tasks.heldElsewhere(yield* graph.blocks.blockById(id)));
        expect(seen?.holder).toContain(sessionName(holder, sessionIdentity));
        const own = yield* signedBy(A)(graph.touches.touch({ projectId, shown: [{ path: 'apps/x/seed', as: 'wrote' }] }));
        expect(own[0]?.touches).toEqual([]);
        expect(yield* graph.touches.of({ projectId, place: 'apps/x/seed' })).toMatchObject([{ task: { id }, wrote: true }]);
        const peer = yield* signedBy(B)(graph.touches.touch({ projectId, shown: [{ path: 'apps/x/seed', as: 'read' }] }));
        expect(peer[0]?.touches).toHaveLength(1);
        yield* signedBy(B)(graph.touches.touch({ projectId, shown: [{ path: 'apps/x/other', as: 'read' }] }));
        expect(yield* graph.touches.of({ projectId, place: 'apps/x/other' })).toEqual([]);
        const taken = yield* signedBy(B)(graph.tasks.claim({ id }));
        expect(table.holderOf(taken)).toBe(yield* graph.sessions.idOf(B));
      }),
    ),
  );
});
