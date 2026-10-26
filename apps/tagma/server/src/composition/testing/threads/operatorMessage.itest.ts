import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer, Stream } from 'effect';
import { parseThreadInboxItem } from '@runlith/agent/thread/persisted';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { modelDefaults, subscriptionLogin } from '../claudeLogin.js';
import { eq } from 'drizzle-orm';
import { threadInbox, birthsOf, turnsOf } from '../../../threads/testing/doubles.js';
import { invocationAssembly } from '../../../invocation/assembly.js';
import { forProject, withAuthority } from '../../../invocation/testing/call.js';
import { OperationId } from '../../../platform/contract/wire/ids.js';
import { ANSWER_ONLY } from '../../../invocation/contract/service/performer.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { ThreadRefused } from '../../../threads/contract/service/failure.js';

const setup = Effect.fnUntraced(function* () {
  const world = yield* makeDoorWorld({
    models: (standing) => ({ ...standing, request: (input) => ({ ...standing.request(input), stream: () => Stream.never }) }),
  });
  const account = yield* subscriptionLogin(world);
  const projectId = yield* world.stealthProject();
  yield* modelDefaults(world, { provider: 'subscription', model: 'claude-sonnet-5-5', reasoning: 'low', account: null });
  yield* projectLeaving(world, projectId);
  return { world, account, projectId };
});

class World extends Context.Service<World, Effect.Success<ReturnType<typeof setup>>>()('testing/OperatorMessageWorld') {}

const family = Effect.fn('testing.operatorMessageFamily')(function* () {
  const { world, account, projectId } = yield* World;
  const births = birthsOf(world.runtime.owners);
  const parent = yield* births.create({ projectId, createdBySessionId: null, title: 'parent', account, approvalMode: 'trust' });
  yield* Effect.addFinalizer(() => turnsOf(world.runtime.owners).delete(parent.thread.id, projectId).pipe(Effect.orDie));
  const child = yield* births.create({ projectId, createdBySessionId: null, parent: parent.thread.id, task: '' });
  const db = Context.get(world.runtime.graph, MachineStore).db;
  const units = Context.get(world.runtime.graph, MachineUnits);
  const notices = Effect.map(
    units.read((unit) => unit.run(db.select().from(threadInbox()).where(eq(threadInbox().threadId, parent.thread.id)).all())),
    (rows) => rows.map(parseThreadInboxItem).filter((item) => item.id.startsWith('operator-message:')),
  );
  return { parent: parent.thread.id, child: child.thread.id, notices };
});

layer(Layer.effect(World, setup()), { excludeTestServices: true, timeout: '30 seconds' })('operator messages to child threads', (it) => {
  it.effect(
    'accepted operator input pins the child and reaches the parent inbox, while project and caller authority gates preserve notice state',
    () =>
      Effect.gen(function* () {
        const { world, projectId } = yield* World;
        const { parent, child, notices } = yield* family();
        const turns = turnsOf(world.runtime.owners);
        const setting = (value: boolean) =>
          Context.get(world.runtime.graph, Settings).write({ key: 'agent.operatorNotice', scope: 'project', projectId, value });
        yield* Effect.acquireRelease(setting(true), () => setting(false).pipe(Effect.orDie));
        const words = 'Do not run builds. "Keep the existing evidence."';
        const records = Context.get(world.runtime.owners, ThreadRecords);
        expect((yield* records.facts(child))?.pinnedAt).toBeNull();
        yield* turns.send(child, projectId, words);
        expect((yield* records.facts(child))?.pinnedAt).toBeInstanceOf(Date);
        expect((yield* records.facts(parent))?.pinnedAt).toBeNull();
        const first = yield* notices;
        expect(first).toHaveLength(1);
        const notice = first[0]!;
        expect(notice.sender).toEqual({ kind: 'host' });
        if (notice.kind !== 'envelope') return yield* Effect.die(new Error('Expected a parent notice'));
        expect(notice.body.intent).toBe('message');
        expect(notice.body.text).toContain(child);
        expect(notice.body.text).toContain(JSON.stringify(words));
        expect(yield* Effect.flip(turns.send(child, projectId + 1000, 'Wrong project.'))).toBeInstanceOf(ThreadRefused);
        expect(yield* notices).toHaveLength(1);
        expect(
          yield* world.op('set_thread_operator_notice', { threadId: child, notice: false }, `project=${projectId}`, {
            [GRANT_HEADER]: grantFor(parent),
          }),
        ).toMatchObject({ status: 200, body: { status: 'set', threadId: child, notice: false } });
        const project = yield* Context.get(world.runtime.graph, Projects).byId(projectId);
        const refused = yield* invocationAssembly.performer
          .performByIdIn(() => Effect.succeed(world.runtime.door))(
            OperationId.make('set_thread_operator_notice'),
            { threadId: child, notice: true },
            {
              caller: {
                actor: {
                  kind: 'thread',
                  threadId: parent,
                  projectId,
                  principalId: 'operator',
                  session: { harness: 'tagma', key: parent },
                },
                files: null,
              },
              place: null,
              world: null,
            },
            ANSWER_ONLY,
          )
          .pipe(forProject(Effect.succeed({ project })), withAuthority('review'), Effect.flip);
        expect(refused).toMatchObject({ code: 'no-approver' });
        expect(yield* Context.get(world.runtime.owners, ThreadMandate).operatorNotice(child)).toBe(false);
      }),
  );
});
