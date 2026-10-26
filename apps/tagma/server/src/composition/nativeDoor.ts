import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { HeapSnapshots } from '@runlith/performance/HeapSnapshots';
import { MemoryCaptures } from '@runlith/performance/MemoryCaptures';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { Effect, Layer } from 'effect';
import type { ChangeRecord } from '../change-record/contract/service/record.js';
import type { JudgingServices } from '../enforcement/serving.js';
import { ServingPool } from '../graph/serving/poolLayer.js';
import { invocationAssembly } from '../invocation/assembly.js';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import type { OperationChecks } from '../invocation/contract/service/operationChecks.js';
import { ThreadExecution } from '../native-harness/contract/service/execution.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { lazyLayer } from '../platform/contract/service/manifest.js';
import type { SandboxFiles } from '../sandbox/contract/service/files.js';
import type { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import type { CacheWarmth } from '../threads/contract/service/evidence.js';
import { CheckoutWrites } from '../workspace/contract/service/checkouts.js';
import type { WorkingOrigins } from '../workspace/contract/service/places.js';
import { callLifetimes } from './callLifetimes.js';

const nativeDoorLayer = Layer.effect(
  ThreadExecution,
  Effect.gen(function* () {
    const owners = yield* Effect.context<
      JudgingServices | OperationChecks | ChangeRecord | SandboxFiles | RunAdmission | CacheWarmth | WorkingOrigins
    >();
    const store = yield* MachineStore;
    return invocationAssembly.nativeDoor(
      owners,
      store.path === ':memory:' ? null : yield* ServingPool,
      yield* OperationCatalog,
      callLifetimes({
        performance: yield* PerformanceReports,
        profiles: yield* CpuProfiles,
        memory: yield* MemoryCaptures,
        heap: yield* HeapSnapshots,
        checkoutActs: yield* CheckoutWrites,
        owners,
      }),
    );
  }),
);

export const nativeDoor = lazyLayer(
  () => import('../native-harness/assembly.js'),
  ({ nativeAgentsLayer }) => nativeAgentsLayer,
).pipe(Layer.provideMerge(nativeDoorLayer));
