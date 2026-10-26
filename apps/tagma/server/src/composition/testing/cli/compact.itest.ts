import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { world } from '@runlith/testbed/worlds';
import { Clock, Context, Effect } from 'effect';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { sql } from 'drizzle-orm';
import { TerminalFixture, terminalWorld } from '../fixture.js';

layer(world(terminalWorld, {}), { excludeTestServices: true })('compact CLI', (it) => {
  it.effect('tagma compact on a running thread answers its request at once, and tagma unqueue takes it back', () =>
    Effect.gen(function* () {
      const world = yield* TerminalFixture;
      const { root } = yield* world.checkout();
      const tagma = (...argv: string[]) => world.tagma(argv, { cwd: root });
      const born = yield* tagma('threads', 'new', '--title', 'compacted-while-running', '--json');
      expect(born.code).toBe(0);
      const threadId = (JSON.parse(born.out) as { id: string }).id;
      const runId = '019d0000-0000-7000-8000-0000000c11c0';
      const store = Context.get(world.runtime.graph, MachineStore);
      const now = yield* Clock.currentTimeMillis;
      yield* Context.get(world.runtime.graph, MachineUnits).write('compact', (tx) =>
        tx.run(
          store.db.run(sql`insert into thread_run (id, thread_id, status, owner_id, created_at, started_at, heartbeat_at, updated_at)
    values (${runId}, ${threadId}, 'running', ${OPERATOR_PRINCIPAL}, ${now}, ${now}, ${now}, ${now})`),
        ),
      );
      const ended = yield* tagma('compact', threadId, '--at', 'end', '--json');
      expect(ended.code).toBe(0);
      const end = JSON.parse(ended.out) as { status: string; runId: string; request: { id: string; at: string } };
      expect(end).toMatchObject({ threadId, status: 'requested', runId, request: { at: 'end' } });
      const stepped = yield* tagma('compact', threadId, '--keep', 'the fixture', '--json');
      expect(stepped.code).toBe(0);
      const step = JSON.parse(stepped.out) as { request: { id: string; at: string } };
      expect(step).toMatchObject({ status: 'requested', runId, request: { at: 'step' } });
      const taken = yield* tagma('unqueue', threadId, end.request.id, '--json');
      expect(taken.code).toBe(0);
      expect(JSON.parse(taken.out)).toEqual({ status: 'unqueued' });
      const again = yield* tagma('unqueue', threadId, end.request.id, '--json');
      expect(again.code).toBe(2);
      expect(JSON.parse(again.out)).toMatchObject({ code: 'not-queued' });
    }),
  );
});
