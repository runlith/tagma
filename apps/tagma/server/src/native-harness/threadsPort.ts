import { Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { NATIVE_HARNESS } from '../platform/contract/wire/session.js';
import type { Unit, WriteUnit } from '../platform/contract/service/units.js';
import { Harness, HarnessFaceMissing } from '../threads/contract/service/harness.js';
import { nativeRolloutPart } from './rollout.js';
import type { ThreadRunStore } from './runs/ledger.js';
import type { NativeThreadState } from '../threads/contract/service/state.js';
import type { ThreadRunning } from '../threads/contract/service/reads.js';

const unbound = (face: string) => Effect.fail(new HarnessFaceMissing({ harness: NATIVE_HARNESS, face }));

export function nativeHarness(
  harness: AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>,
  threads: ThreadRunning['Service'],
  runs: ThreadRunStore,
): Harness['Service'] {
  const handle = (threadId: string) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
  return Harness.of({
    born: (request, within) => harness.threads.create(request, within),
    recover: () => Effect.asVoid(harness.runs.recoverNow()),
    retract: (threadId, signalId, within) =>
      handle(threadId)
        .retractSignal(signalId, (unit) =>
          Effect.mapError(within(unit), (cause) => new ThreadStorageFailed({ call: 'CommandNotice.discharge', cause })),
        )
        .pipe(Effect.asVoid),
    folded: (threadId, records) => nativeRolloutPart.folds.write(nativeRolloutPart.folds.rows(threadId, records)),
    record: nativeRolloutPart,
    row: () => Effect.succeed(null),
    models: () => unbound('models'),
    spent: (spawnRootId, principal) => Effect.map(runs.spentBySpawnRoot(spawnRootId, principal), (tokens) => ({ tokens, unmeasured: [] })),
  });
}
