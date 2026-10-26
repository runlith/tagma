import { Effect, Layer } from 'effect';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import type { Registration } from '@runlith/executions/protocol/registration';
import { Custodian } from './Custodian';
import type { Holder } from './holder/Holder';
import type { ExecutionCapacity } from './ExecutionCapacity';
import { HostAdmission } from './HostAdmission';
import { executionStore, ExecutionStore } from './store/ExecutionStore';
import type { StoreFailure, StoreLost, StoreOpenFailure, StoreUnreadable } from './store/errors';
import { reportDeadFiber } from './hostTelemetry';

export const hostState = (
  path: string,
  registration: Registration,
  processes: ProcessPool,
): Layer.Layer<ExecutionStore | HostAdmission | Custodian, StoreOpenFailure | StoreUnreadable | StoreLost, ExecutionCapacity | Holder> => {
  const store = executionStore(path, registration, processes);

  const owners = Layer.unwrap(
    Effect.gen(function* () {
      const executions = yield* ExecutionStore;
      const entered = yield* executions.incarnation();
      return Layer.provideMerge(Custodian.layer(entered.incarnation), HostAdmission.layer(entered.phase));
    }),
  );

  const fencing = Layer.effectDiscard(
    Effect.gen(function* () {
      const executions = yield* ExecutionStore;
      const admitting = yield* HostAdmission;
      yield* Effect.forkScoped(
        reportDeadFiber(
          'admission-fence',
          Effect.flatMap(executions.lost(), () => admitting.fence()),
        ),
      );
    }),
  );

  return fencing.pipe(Layer.provideMerge(owners), Layer.provideMerge(store));
};
