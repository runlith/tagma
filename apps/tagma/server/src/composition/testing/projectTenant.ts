import { Context, Effect, Queue, Schema, Stream } from 'effect';
import type { threadSendSchema } from '@runlith/agent/protocol/realtime';
import { REGISTRY_OPERATIONS } from '../../graph/contract/wire/operations/registry.js';
import { knownAnswer } from '../../platform/contract/wire/operation.js';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { threadCreateSchema } from '../../threads/contract/wire/creation.js';
import { ROUTE_OPERATIONS } from '../../threads/contract/wire/operations/routes.js';
import { TURN_OPERATIONS } from '../../threads/contract/wire/operations/turns.js';
import { type DoorFixture, projectLeaving } from './doorFixture.js';

export type Performer<E> = (id: string, payload: unknown) => Effect.Effect<unknown, E>;

export const projectTenant = Effect.fn('testing.projectTenant')(function* <E>(
  world: DoorFixture['Service'],
  label: string,
  performerOf: (projectId: number) => Performer<E>,
) {
  const checkout = yield* world.directory(label);
  const projectId = yield* world.stealthProject(checkout);
  yield* projectLeaving(world, projectId);
  const perform = performerOf(projectId);
  const { project } = yield* Schema.decodeUnknownEffect(knownAnswer(REGISTRY_OPERATIONS.read_project.answer))(
    yield* perform('read_project', { ref: String(projectId) }),
  );
  if (project === null) return yield* Effect.die(new Error(`the tenant lost project ${projectId} after its creation`));
  const harness = Context.get(world.runtime.owners, ThreadHarness);
  const thread = Effect.fn('testing.projectTenant.thread')(function* (input: typeof threadCreateSchema.Type = {}) {
    const answer = yield* Schema.decodeUnknownEffect(knownAnswer(ROUTE_OPERATIONS.create_thread.answer))(
      yield* perform('create_thread', { approvalMode: 'bypass', ...input }),
    );
    return answer.snapshot.thread;
  });
  const turn = Effect.fn('testing.projectTenant.turn')(function* (threadId: string, input: typeof threadSendSchema.Type) {
    const ended = yield* Queue.unbounded<string>();
    yield* harness.runs.settlements().subscribe({
      name: `tenant turn ${threadId}/${input.key}`,
      at: 'after-stages',
      handle: (event) => (event.threadId === threadId ? Queue.offer(ended, event.runId).pipe(Effect.asVoid) : Effect.void),
    });
    const { runId } = yield* Schema.decodeUnknownEffect(knownAnswer(TURN_OPERATIONS.start_turn.answer))(
      yield* perform('start_turn', { threadId, ...input }),
    );
    const run = yield* harness.runs.ledger().runById(runId);
    if (run === null) return yield* Effect.die(new Error(`the tenant turn lost run ${runId} after its start`));
    if (run.status === 'running')
      yield* Stream.runDrain(
        Stream.take(
          Stream.filter(Stream.fromQueue(ended), (id) => id === runId),
          1,
        ),
      );
    return { runId };
  }, Effect.scoped);
  return { projectId, projectName: project.name, checkout, perform, thread, turn };
});

export const doorTenant = (world: DoorFixture['Service'], label = 'tenant') =>
  projectTenant(
    world,
    label,
    (projectId) => (id, payload) => Effect.map(world.op(id, payload, `project=${projectId}`), (answer) => answer.body),
  );
