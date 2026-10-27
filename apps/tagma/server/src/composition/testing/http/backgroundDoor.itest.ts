import { callerInThread } from '../callers';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Data, Effect, FileSystem, Layer, Schedule } from 'effect';
import { openToolDoor } from '@runlith/agent/door/openToolDoor';
import { ToolJudge } from '@runlith/agent/door/openToolDoor';
import { builtinMode } from '../modes.js';
import type { Tool } from '@runlith/agent/tool';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { GRANT_HEADER, GRANT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantEnvironment } from '../../../platform/testing/grants.js';
import { NATIVE_HARNESS } from '../../../platform/contract/wire/session.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { callDelivery } from '../../../native-harness/testing/doubles.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { OUTCOME_HEADER } from '../../../invocation/contract/wire/headers.js';
import { TargetPreparation } from '../../../threads/contract/service/preparation.js';
import { originOf } from '../../../threads/contract/wire/target.js';
import { HarnessCalls } from '../../../threads/contract/service/engine.js';
import { OwedCalls } from '../../../threads/contract/service/owedCalls.js';
import { inboxOf } from '../../../threads/testing/doubles.js';
import { Worlds } from '../../../executions/contract/service/worlds.js';
import { fixtureNativeCatalog } from '../nativeCatalog.js';
import { WorkPlaces } from '../../../threads/contract/service/working.js';
import { makeDoorWorld } from '../doorFixture.js';

const READ = 'read_project';

class NoticePending extends Data.TaggedError('NoticePending')<{ readonly message: string }> {}

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  const files = yield* FileSystem.FileSystem;
  const project = yield* world.stealthProject(yield* files.realPath(yield* world.directory('detached')));
  const born = yield* world.call(`/api/op/create_thread?project=${project}`, { method: 'POST', body: {} });
  const holder = (born.body as { snapshot: { thread: { id: string } } }).snapshot.thread.id;
  const grant = grantEnvironment(holder, testSessionIdentity)[GRANT_VARIABLE] as string;
  const row = yield* Context.get(world.runtime.graph, Projects).byId(project);
  const worlds = Context.get(world.runtime.owners, Worlds);
  const admitted = yield* Context.get(world.runtime.owners, TargetPreparation).of(
    { id: holder, projectId: project },
    { kind: 'tools', runId: null, context: null },
    (request) => worlds.of({ thread: { id: holder, hostKind: null, hostId: null }, ...request }),
  );
  const caller: Caller = {
    actor: {
      kind: 'thread',
      threadId: holder,
      projectId: project,
      principalId: OPERATOR_PRINCIPAL,
      session: { harness: NATIVE_HARNESS, key: holder },
    },
    files: world.runtime.scratch.scope(holder),
  };
  const vocabulary = yield* Context.get(world.routed, Tags).of(project);
  const served = yield* world.runtime.pool.resolve({ projectId: project });
  const native = yield* fixtureNativeCatalog(
    {
      caller,
      place: { root: admitted.world.root, origin: originOf(admitted.target) },
      world: 'checkout',
      standing: { world: admitted.world, projectRoot: row.rootPath },
      project: { id: project, name: row.name },
      vocabulary: () => vocabulary,
      identity: testSessionIdentity,
      served,
      graphRoot: served.checkout,
      places: Context.get(world.runtime.owners, WorkPlaces),
      owners: Context.mergeAll(world.routed, world.runtime.owners, world.runtime.workspace, world.runtime.enforcement),
    },
    [READ],
  );
  return { world, project, holder, grant, native };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/BackgroundPlace') {}

const atHttp = Effect.fnUntraced(function* (id: string, input: unknown) {
  const { world, project, grant } = yield* Place;
  const response = yield* Effect.promise((signal) =>
    world.app(
      new Request(`http://tagma/api/op/${id}?project=${project}`, {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json', [GRANT_HEADER]: grant },
        body: JSON.stringify(input),
      }),
      world.routed,
    ),
  );
  const body = (yield* Effect.promise(() => response.json())) as Record<string, unknown>;
  return { outcome: response.headers.get(OUTCOME_HEADER), body };
});

const atNative = Effect.fnUntraced(function* (input: unknown, toolCallId: string) {
  const { world, holder, native } = yield* Place;
  const owed = Context.get(world.runtime.owners, OwedCalls);
  const delivery = yield* callDelivery(owed);
  const door = openToolDoor<Record<string, never>>(
    'run-native',
    callerInThread(holder, 'run-native'),
    {},
    new ToolJudge(builtinMode('bypass')),
    undefined,
    undefined,
    undefined,
    undefined,
    Context.get(world.runtime.owners, HarnessCalls),
    () => ({
      retain: () => Effect.succeed({ release: Effect.void }),
      detaching: (call) => delivery.detaching(call),
      completed: (call, exit) => delivery.completed(call, exit),
    }),
  );
  return yield* door.settle({ name: READ, tool: native[READ]!, input, options: { toolCallId, messages: [] } });
});

const noticed = Effect.fnUntraced(function* (runId: string, toolCallId: string) {
  const { world } = yield* Place;
  return yield* inboxOf(world.runtime.owners).receipt(`tool-result:${JSON.stringify([runId, toolCallId])}`);
});

const reached = Effect.fnUntraced(
  function* (runId: string, toolCallId: string) {
    if ((yield* noticed(runId, toolCallId)) !== undefined) return;
    return yield* new NoticePending({ message: `no notice for ${runId} ${toolCallId}` });
  },
  (effect) => Effect.retry(effect, { schedule: Schedule.spaced('10 millis') }),
);

layer(Layer.effect(Place, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
  excludeTestServices: true,
})('background operations', (it) => {
  it.effect(
    'an operation asked `background: true` answers the same receipt at the native tool and at /api/op, and each ending reaches the thread once',
    () =>
      Effect.gen(function* () {
        const { world, holder } = yield* Place;
        const natively = yield* atNative({ background: true }, 'native-long');
        const overHttp = yield* atHttp(READ, { background: true });
        const receiptOf = (value: unknown) => {
          const { runId: _run, toolCallId: _call, ...shape } = value as Record<string, unknown>;
          return shape;
        };
        expect(overHttp.outcome).toBe('answer');
        expect(receiptOf(natively.output)).toEqual(receiptOf(overHttp.body));
        expect(overHttp.body).toMatchObject({ status: 'running', tool: READ });
        const httpRun = overHttp.body.runId as string;
        const httpCall = overHttp.body.toolCallId as string;
        yield* reached('run-native', 'native-long');
        yield* reached(httpRun, httpCall);
        const listed = yield* atHttp('read_calls', {});
        const rows = (listed.body.calls as readonly { toolCallId: string; mode: string; phase: string }[]).filter(
          (row) => row.toolCallId === 'native-long' || row.toolCallId === httpCall,
        );
        expect(rows.map((row) => row.mode)).toEqual(['background', 'background']);
        expect(yield* Context.get(world.runtime.owners, OwedCalls).owed({ threadId: holder })).toEqual([]);
      }),
  );

  it.effect(
    'a thread’s operation called without the field answers in place at both doors, and a read asked `background: true` answers a receipt',
    () =>
      Effect.gen(function* () {
        const natively = yield* atNative({}, 'native-waited');
        const overHttp = yield* atHttp(READ, {});
        expect((natively.output as { status?: string }).status).not.toBe('running');
        expect(overHttp.body.status).not.toBe('running');
        const short = yield* atHttp('read_calls', { background: true });
        expect(short.body).toMatchObject({ status: 'running', tool: 'read_calls' });
        yield* reached(short.body.runId as string, short.body.toolCallId as string);
      }),
  );
});
