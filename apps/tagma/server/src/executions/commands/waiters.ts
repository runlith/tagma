import { Context, Effect, Queue } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { command, commandDelivery, commandWait } from '../store/terminal.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { ExecutionStoreFailure } from '../store/rows.js';
import type { NoticeTakeBack } from '../contract/service/notices.js';
import { CommandWaiters } from '../contract/service/commands.js';
import type { CommandDeliveries } from '../store/deliveries.js';

export const DELIVERY_PAGE = 100;

const UNMEASURED_AT_RESTART =
  'The checkout was not measured after this command: the server restarted while it ran, so what it changed is attributed to nobody — read_changes shows what stands.';

export class TakeBackOpening extends Context.Service<
  TakeBackOpening,
  {
    open(takeBack: NoticeTakeBack['Service']): Effect.Effect<void>;
  }
>()('tagma/executions/TakeBackOpening') {}

export const makeCommandWaiters = Effect.fnUntraced(function* ({
  deliveries,
  ended,
  takeBack,
}: {
  readonly deliveries: CommandDeliveries;
  readonly ended: Queue.Queue<ExecutionRef>;
  readonly takeBack: Effect.Effect<NoticeTakeBack['Service']>;
}) {
  const units = yield* MachineUnits;
  const due = (execution: ExecutionRef) => Effect.asVoid(Queue.offer(ended, execution));

  const answered = Effect.fn('CommandWaiters.answered')(function* (
    execution: ExecutionRef,
    thread: ThreadId,
    signalId: string,
    alongside: (unit: WriteUnit<'machine'>) => Effect.Effect<void, ExecutionStoreFailure | StoreFailure>,
  ) {
    const notices = yield* takeBack;
    yield* notices.retract(thread, signalId, (unit) =>
      Effect.andThen(alongside(unit), deliveries.dischargeDelivery(unit, execution, thread)),
    );
  });

  return CommandWaiters.of({
    owed: Effect.fn('CommandWaiters.owed')(function* (execution) {
      return yield* units.read((unit) => deliveries.delivery(unit, execution));
    }),
    outstanding: Effect.fn('CommandWaiters.outstanding')(function* (after) {
      return yield* units.read((unit) => deliveries.deliveriesOwed(unit, after, DELIVERY_PAGE));
    }),
    owing: Effect.fn('CommandWaiters.owing')(function* (threads) {
      return yield* units.read((unit) => deliveries.owing(unit, threads));
    }),
    accepted: deliveries.acceptDelivery,
    delivered: Effect.fn('CommandWaiters.delivered')(function* (execution) {
      yield* units.write(writes('CommandWaiters.delivered', [commandDelivery]), (unit) => deliveries.settleDelivery(unit, execution));
    }),
    take: Effect.fn('CommandWaiters.take')(function* (execution, thread) {
      return yield* units.write(writes('CommandWaiters.take', [commandDelivery]), (unit) =>
        deliveries.takeDelivery(unit, execution, thread),
      );
    }),
    seen: Effect.fn('CommandWaiters.seen')(function* (execution, thread, signalId) {
      yield* answered(execution, thread, signalId, () => Effect.void);
    }),
    answered,
    unread: Effect.fn('CommandWaiters.unread')(function* (execution) {
      if (yield* units.write(writes('CommandWaiters.unread', [commandDelivery]), (unit) => deliveries.releaseDelivery(unit, execution))) {
        yield* Queue.offer(ended, execution);
      }
    }),
    due,
    debts: takeBack,
    background: Effect.fn('CommandWaiters.background')(function* (execution, expected, owed, call) {
      const notices = yield* takeBack;
      return yield* units.write(writes('CommandWaiters.background', [commandWait, commandDelivery], notices.calls), (unit) =>
        Effect.gen(function* () {
          const move = yield* deliveries.moveCommandWait(unit, execution, expected, 'background');
          if (move._tag !== 'Moved') return move;
          if (owed !== null) yield* deliveries.openDelivery(unit, owed);
          if (call !== null) yield* notices.release(unit, call);
          return move;
        }),
      );
    }),
    measured: Effect.fn('CommandWaiters.measured')(function* (execution, words) {
      yield* units.write(writes('CommandWaiters.measured', [command]), (unit) => deliveries.measure(unit, execution, words));
      yield* due(execution);
    }),
    measurement: (execution) => units.read((unit) => deliveries.measurement(unit, execution)),
    recover: Effect.fn('CommandWaiters.recover')(function* () {
      yield* units.write(writes('CommandWaiters.recover', [commandDelivery, command]), (unit) =>
        Effect.andThen(deliveries.releaseClaims(unit), deliveries.unmeasured(unit, UNMEASURED_AT_RESTART)),
      );
    }),
    ended,
  });
});
