import { Context, Effect } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import { HarnessOwner, NativeStorage, ThreadHarness } from '../../../threads/contract/service/engine.js';
import { birthsOf } from '../../../threads/testing/doubles.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';
import { acpTestSeat as acpSeat } from '../../../external-harnesses/testing/seats.js';
import { makeTerminalWorld } from '../fixture.js';

export const runnerWorld = Effect.fnUntraced(function* () {
  const world = yield* makeTerminalWorld();
  const checkout = yield* world.checkout();
  return { world, url: world.url, root: checkout.root, projectId: checkout.id };
});
export type RunnerWorld = Effect.Success<ReturnType<typeof runnerWorld>>;

export const hostedThread = Effect.fnUntraced(
  function* (at: RunnerWorld, approvalMode: AgentApprovalMode) {
    const threadId = (yield* birthsOf(at.world.runtime.owners).create({ projectId: at.projectId, createdBySessionId: null, approvalMode }))
      .thread.id;
    const seat = acpSeat('claude-code', 'tagma', undefined);
    yield* sessionFor(Context.get(at.world.runtime.graph, MachineStore).db, threadId, seat.facet, seat.kernel);
    return threadId;
  },
  (effect, at) => Effect.provide(effect, at.world.runtime.owners),
);

export const hostedRun = <A, E, R>(at: RunnerWorld, thread: string, runId: string, turn: Effect.Effect<A, E, R>) => {
  const runtime = at.world.runtime;
  const owners = runtime.owners;
  const storage = Context.get(owners, NativeStorage);
  const ownerId = Context.get(owners, HarnessOwner).id;
  const units = Context.get(runtime.graph, MachineUnits);
  const starting = units.write(storage.writes, (unit) =>
    storage.runs(ownerId).createRun(
      {
        startFrom: {
          id: thread,
          ownerId,
          account: null,
          provider: 'claude-code',
          model: 'claude-haiku-4-5',
          reasoning: null,
          switches: {},
        },
        kind: 'turn',
        approval: { mode: 'trust', interactive: false },
        progress: { stage: null, message: null },
        runId,
      },
      unit,
    ),
  );
  const ending = Effect.suspend(() => {
    const ended = Context.get(owners, ThreadHarness).runs.reports().of('acp').ended({ id: runId, threadId: thread }, { kind: 'completed' });
    return units.write(storage.writes, (unit) => ended.run(unit as unknown as ThreadWriteTx));
  });
  return Effect.provide(
    Effect.acquireUseRelease(
      starting,
      () => Effect.scoped(turn),
      () => Effect.orDie(ending),
    ),
    owners,
  );
};
