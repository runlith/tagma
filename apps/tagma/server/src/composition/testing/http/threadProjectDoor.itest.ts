import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { toolDecode } from '@runlith/agent/tool/arguments';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { doorFixture, DoorFixture, projectLeaving } from '../doorFixture.js';
import { makeThreadDoors } from '../threadDoors.js';

const setup = Effect.gen(function* () {
  const world = yield* DoorFixture;
  const home = yield* world.plainProject();
  const elsewhere = yield* world.stealthProject(yield* world.directory('elsewhere'));
  yield* projectLeaving(world, home, elsewhere);
  return { world, home, elsewhere };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ThreadProject') {}

type Born = { snapshot: { thread: { id: string } } };

const born = Effect.fnUntraced(function* (projectId: number, title: string) {
  const { world } = yield* Place;
  const answer = yield* world.call(`/api/op/create_thread?project=${projectId}`, {
    method: 'POST',
    body: { title, approvalMode: 'bypass' },
  });
  expect(answer.status).toBe(200);
  return (answer.body as Born).snapshot.thread.id;
});

const asThread = Effect.fnUntraced(function* (threadId: string, path: string, body: unknown) {
  const { world } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma${path}`, {
        signal,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [GRANT_HEADER]: grantEnvironment(threadId, testSessionIdentity)[GRANT_VARIABLE] as string,
        },
        body: JSON.stringify(body),
      }),
      world.routed,
    ),
  );
  const answer: unknown = yield* Effect.promise(() => response.json().catch(() => null));
  return { status: response.status, body: answer };
});

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(doorFixture())), { excludeTestServices: true })('thread project door', (it) => {
  it.effect('an agent acts on a thread in the thread’s own project, and a project contradicting the thread refuses place-mismatch', () =>
    Effect.gen(function* () {
      const { world, home, elsewhere } = yield* Place;
      const agent = yield* born(home, 'the agent');
      const stranger = yield* born(elsewhere, 'the stranger');
      expect((yield* world.op('read_thread_snapshot', { threadId: stranger }, `project=${home}`)).body).toMatchObject({
        code: 'place-mismatch',
      });
      expect((yield* world.op('read_thread_snapshot', { threadId: stranger })).body).toMatchObject({
        status: 'loaded',
        snapshot: { thread: { id: stranger } },
      });
      expect((yield* asThread(agent, '/api/op/read_thread', { threadId: stranger })).body).toMatchObject({ status: 'ok' });
      expect((yield* asThread(agent, `/api/op/read_law?project=${elsewhere}`, {})).status).toBe(200);
      for (const [operation, body, status] of [
        ['pin_thread', { threadId: stranger }, 'pinned'],
        ['set_thread_delegation', { threadId: stranger, delegation: false }, 'switched'],
        ['archive_thread', { threadId: stranger }, 'archived'],
      ] as const) {
        expect((yield* asThread(agent, `/api/op/${operation}?project=${home}`, body)).body).toMatchObject({
          code: 'place-mismatch',
        });
        expect((yield* asThread(agent, `/api/op/${operation}`, body)).body).toMatchObject({ status, threadId: stranger });
      }
    }),
  );

  it.effect('delete_thread reaches the thread’s home through native input, HTTP input and the CLI transport selector', () =>
    Effect.gen(function* () {
      const { world, home, elsewhere } = yield* Place;
      const created = yield* world.op('create_thread', { approvalMode: 'bypass' }, `project=${home}`);
      const agent = (created.body as { snapshot: { thread: { id: string; ownerId: string } } }).snapshot.thread;
      const native = makeThreadDoors(world, home, ['delete_thread', 'read_thread']);
      const door = yield* native.doorsFor(agent.id, agent.ownerId);
      expect((yield* asThread(agent.id, '/api/op/list_threads', { project: elsewhere })).status).toBe(200);
      expect((yield* asThread(agent.id, `/api/op/read_law?project=${elsewhere}`, {})).status).toBe(200);
      const decode = Effect.fnUntraced(function* (id: string, input: unknown) {
        const tool = door.native[id];
        if (tool === undefined) return yield* Effect.die(new Error(`missing ${id}`));
        return yield* toolDecode(tool, input);
      });
      for (const surface of ['native', 'http', 'cli'] as const) {
        const stranger = yield* born(elsewhere, surface);
        const input = { threadId: stranger };
        if (surface === 'cli') {
          expect((yield* asThread(agent.id, `/api/op/delete_thread?project=${home}`, input)).body).toMatchObject({
            code: 'place-mismatch',
          });
        }
        const deleted =
          surface === 'native'
            ? yield* native.atNative('delete_thread', yield* decode('delete_thread', input), door)
            : {
                value: (yield* asThread(agent.id, `/api/op/delete_thread${surface === 'cli' ? `?project=${elsewhere}` : ''}`, input)).body,
              };
        expect(deleted).toMatchObject({ value: { status: 'deleted', threadId: stranger } });
        expect((yield* world.op('read_thread', input, `project=${elsewhere}`)).body).toMatchObject({ code: 'not-found' });
      }
      expect(yield* native.atNative('read_thread', yield* decode('read_thread', { threadId: agent.id }), door)).toMatchObject({
        class: 'answer',
        value: { status: 'ok' },
      });
    }),
  );

  it.effect('a thread nobody holds is one declared refusal on every operation that names it, never an answer of its own', () =>
    Effect.gen(function* () {
      const { world, home } = yield* Place;
      const gone = '01a0ee4d-0000-7000-8000-000000000000';
      for (const [operation, body] of [
        ['pin_thread', { threadId: gone }],
        ['archive_thread', { threadId: gone }],
        ['delete_thread', { threadId: gone }],
        ['locate_thread', { threadId: gone }],
        ['set_thread_title', { threadId: gone, title: 'nothing' }],
        ['repair_thread_rollout', { threadId: gone }],
        ['read_thread_agent', { threadId: gone }],
        ['refresh_thread_instructions', { threadId: gone }],
      ] as const) {
        const missing = yield* world.call(`/api/op/${operation}?project=${home}`, { method: 'POST', body });
        expect({ operation, status: missing.status, body: missing.body }).toMatchObject({ status: 409, body: { code: 'not-found' } });
      }
    }),
  );
});
