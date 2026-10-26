import { Cause, Clock, Effect, Exit, FiberMap, Option, Schedule } from 'effect';
import { type OutcomeRefused, Outcomes } from './contract/service/outcomes.js';
import { Ledger } from './store/ledger.js';

const RETRIES_MS = [5_000, 30_000, 120_000, 300_000, 900_000, 3_600_000] as const;
const AGAIN = Schedule.spaced('10 seconds');

const reasonOf = (cause: Cause.Cause<OutcomeRefused>): string => {
  const refused = Cause.findErrorOption(cause);
  return Option.isSome(refused) ? refused.value.reason : `the receiver failed: ${Cause.pretty(cause)}`;
};

export const makeHandback = Effect.gen(function* () {
  const ledger = yield* Ledger;
  const outcomes = yield* Outcomes;
  const fibers = yield* FiberMap.make<string, void, never>();

  const hand = (id: string) => Effect.asVoid(FiberMap.run(fibers, id, keep(id), { onlyIfMissing: true }));

  const resume = Effect.fn('Outcomes.resume')(function* () {
    for (const row of yield* ledger.unhanded) yield* hand(row.id);
  });

  const keep = Effect.fn('Outcomes.deliver')(
    function* (id: string) {
      for (let attempt = 0; ; attempt += 1) {
        const row = yield* ledger.byId(id);
        if (row === undefined || row.deliveredAt !== null || row.outcome === null || row.endedAt === null) return;
        const exit = yield* Effect.exit(
          outcomes.deliver({
            id,
            sender: row.sender,
            title: row.title,
            kind: row.outcome,
            answer: row.answer,
            at: row.endedAt,
          }),
        );
        if (Exit.isSuccess(exit)) return yield* ledger.handed(id, yield* Clock.currentTimeMillis);
        if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.interrupt;
        yield* Effect.logWarning('a notification outcome was not taken and is handed again', {
          id,
          sender: row.sender,
          reason: reasonOf(exit.cause),
        });
        yield* Effect.sleep(RETRIES_MS[Math.min(attempt, RETRIES_MS.length - 1)]!);
      }
    },
    (work, id) =>
      work.pipe(
        Effect.tapError((failure) => Effect.logError(`notification ${id} could not be read or recorded and is tried again`, failure)),
        Effect.retry(AGAIN),
        Effect.orDie,
      ),
  );

  return { hand, resume };
});

export type Handback = Effect.Success<typeof makeHandback>;
