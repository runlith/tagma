import { Effect, Layer } from 'effect';
import { Schedules } from './contract/service/schedules.js';
import { TickReceivers } from './contract/service/receivers.js';
import { ScheduleContributions } from './contract/service/contributions.js';
import { ledgerLayer } from './store/ledger.js';
import { makeTimetable } from './timetable.js';

export const scheduleLayer = Layer.effect(
  Schedules,
  Effect.gen(function* () {
    const timetable = yield* makeTimetable;
    const receivers = yield* TickReceivers;
    const contributions = yield* ScheduleContributions;
    yield* Effect.acquireRelease(
      contributions.declare((owner, cadences, receiver) =>
        Effect.gen(function* () {
          const leave = receivers.register(owner, receiver);
          const withdraw = () => {
            leave();
            timetable.withdraw(owner);
          };
          yield* Effect.onError(timetable.declare(owner, cadences), () => Effect.sync(withdraw));
          return withdraw;
        }),
      ),
      (withdraw) => Effect.sync(withdraw),
    );
    return timetable;
  }),
).pipe(Layer.provide(ledgerLayer));
