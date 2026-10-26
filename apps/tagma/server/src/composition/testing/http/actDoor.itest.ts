import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { sql } from 'drizzle-orm';
import { ACT_HEADER, GRANT_HEADER, GRANT_VARIABLE, actValue } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { makeDoorWorld } from '../doorFixture.js';

type Born = {
  snapshot: { thread: { id: string; bornOf?: { by: string; step: number } | null } };
};

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  return { world, projectId: yield* world.stealthProject() };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ActPlace') {}

const operatorRoot = Effect.fnUntraced(function* (title: string) {
  const { world, projectId } = yield* Place;
  const born = yield* world.call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: { title } });
  expect(born.status).toBe(200);
  return (born.body as Born).snapshot.thread.id;
});

const runOf = Effect.fnUntraced(function* (threadId: string) {
  const { world } = yield* Place;
  const id = crypto.randomUUID();
  const now = yield* Clock.currentTimeMillis;
  yield* Context.get(world.runtime.graph, MachineStore).db.run(
    sql`insert into thread_run (id, thread_id, status, owner_id, started_at, heartbeat_at, created_at, updated_at) values (${id}, ${threadId}, 'running', 'operator', ${now}, ${now}, ${now}, ${now})`,
  );
  return id;
});

const createThreadAs = Effect.fnUntraced(function* (threadId: string, act: string | null, body: unknown) {
  const { world, projectId } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/create_thread?project=${projectId}`, {
        signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string,
          ...(act === null ? {} : { [ACT_HEADER]: act }),
        },
        body: JSON.stringify(body),
      }),
      world.routed,
    ),
  );
  expect(response.status).toBe(200);
  return ((yield* Effect.promise(() => response.json())) as Born).snapshot.thread;
});

const createAs = (threadId: string, act: string | null, body: unknown) =>
  Effect.map(createThreadAs(threadId, act, body), (thread) => thread.bornOf ?? null);

layer(Layer.effect(Place, setup), { excludeTestServices: true })('act HTTP door', (it) => {
  it.effect("a root an agent's shell creates records the calling run and step, and two calls of one step share it", () =>
    Effect.gen(function* () {
      const lead = yield* operatorRoot('the lead');
      const run = yield* runOf(lead);
      const first = yield* createAs(lead, actValue(run, 4), { title: 'worker a' });
      const second = yield* createAs(lead, actValue(run, 4), { title: 'worker b' });
      const later = yield* createAs(lead, actValue(run, 5), { title: 'worker c' });
      expect(first).toEqual({ by: run, step: 4 });
      expect(second).toEqual(first);
      expect(later).toEqual({ by: run, step: 5 });
    }),
  );

  it.effect("an act naming another thread's run, or none, or no run at all records nothing", () =>
    Effect.gen(function* () {
      const lead = yield* operatorRoot('the signer');
      const other = yield* operatorRoot('someone else');
      const foreign = yield* runOf(other);
      expect(yield* createAs(lead, actValue(foreign, 1), { title: 'borrowed act' })).toBeNull();
      expect(yield* createAs(lead, 'not-an-act', { title: 'garbled act' })).toBeNull();
      expect(yield* createAs(lead, actValue(crypto.randomUUID(), 1), { title: 'no such run' })).toBeNull();
      expect(yield* createAs(lead, null, { title: 'no act' })).toBeNull();
    }),
  );

  it.effect("a thread an agent creates records the caller's session of the machine store, which the thread's own foreign key names", () =>
    Effect.gen(function* () {
      const { world } = yield* Place;
      const lead = yield* operatorRoot('the creator');
      const worker = yield* createThreadAs(lead, null, { title: 'worker' });
      const opener = yield* Context.get(world.runtime.graph, MachineStore).db.all<{ harness: string; key: string }>(
        sql`select s.harness, s.key from thread t join session s on s.id = t.created_by_session_id where t.id = ${worker.id}`,
      );
      expect(opener).toEqual([{ harness: 'tagma', key: lead }]);
    }),
  );
});
