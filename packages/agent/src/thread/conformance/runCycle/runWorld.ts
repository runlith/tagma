import { Context, Effect, Layer } from 'effect';
import { SpawnSeats } from '../../../collaboration/collaborationResidency';
import { approvalModesLayer } from '../../../modes/ApprovalModes';
import { ModeLaw, modeLawLayer } from '../../../modes/ModeLaw';
import type { ThreadRunStorage } from '../../storage/runs';
import { RunSweep, ThreadFeed, type ThreadTx, type ThreadWriteTx } from '../../ThreadPorts';
import { fakeAdapter, transportsOver } from '../fakeTransport';
import { ApprovalParking, approvalParkingLayer } from '../../run/ApprovalParking';
import { RunLifecycle } from '../../run/lifecycle/RunLifecycle';
import { RunAdmission } from '../../run/runAdmission';
import { RunExecution, runExecutionLayer } from '../../run/RunExecution';
import { threadRunInboxLayer } from '../../run/ThreadRunInbox';
import { threadRunLedgerLayer } from '../../run/ThreadRunLedger';
import { ThreadRunSettlements } from '../../run/ThreadRunSettlements';
import { lifecycleFixture, type LifecycleOptions } from './lifecycle';

export type RunWorldOptions = LifecycleOptions & { readonly sweep?: RunSweep['Service'] };

export const runWorld = Effect.fnUntraced(function* (runs: ThreadRunStorage<ThreadTx, ThreadWriteTx>, options: RunWorldOptions = {}) {
  const adapter = fakeAdapter();
  const fixture = lifecycleFixture(runs, { ...options, transports: transportsOver(adapter) });
  const layer = runExecutionLayer.pipe(
    Layer.provideMerge(Layer.succeed(RunSweep, options.sweep ?? null)),
    Layer.provideMerge(Layer.merge(approvalParkingLayer, modeLawLayer.pipe(Layer.provide(approvalModesLayer)))),
    Layer.provideMerge(threadRunInboxLayer),
    Layer.provideMerge(threadRunLedgerLayer),
    Layer.provideMerge(
      Layer.succeed(
        ThreadFeed,
        ThreadFeed.of({
          atCut: (_id, work) => work,
          tail: () => {},
          append: () => {},
          progress: () => {},
          view: () => ({ at: { position: 0, seq: 0 }, open: [], progress: null }),
          liveView: () => ({ incarnation: 'no-live-run', runId: null, at: { position: 0, seq: 0 }, open: [], progress: null }),
          publish: () => Effect.void,
          carry: () => Effect.void,
        }),
      ),
    ),
    Layer.provideMerge(fixture.layer),
  );
  const context = yield* Layer.build(layer);
  const execution = Context.get(context, RunExecution);
  adapter.bind(execution);
  return {
    context,
    adapter,
    execution,
    aggregate: fixture.aggregate,
    inbox: fixture.inbox,
    journal: fixture.journal.log,
    lifecycle: Context.get(context, RunLifecycle),
    settlements: Context.get(context, ThreadRunSettlements),
    seats: Context.get(context, SpawnSeats),
    parking: Context.get(context, ApprovalParking),
    laws: Context.get(context, ModeLaw),
    admission: Context.get(context, RunAdmission),
  };
});
