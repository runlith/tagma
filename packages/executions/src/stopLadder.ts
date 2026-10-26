import { Effect, Fiber, Option } from 'effect';
import { STOP_LADDER, type StopStep } from './protocol/call';
import type { EndedAt } from './protocol/stop';

export type FirstStep = Extract<StopStep, 'interrupt' | 'hang-up'>;

export type Opening = FirstStep | 'terminate' | 'kill';

const ESCALATION: ReadonlyArray<readonly [StopStep, number]> = [
  ['terminate', STOP_LADDER.killAtMs],
  ['kill', STOP_LADDER.killAtMs + STOP_LADDER.reapMs],
];

const ladderFrom = (first: Opening): ReadonlyArray<readonly [StopStep, number]> =>
  first === 'kill'
    ? [['kill', STOP_LADDER.reapMs]]
    : first === 'terminate'
      ? ESCALATION.map(([step, until]) => [step, until - STOP_LADDER.terminateAtMs] as const)
      : [[first, STOP_LADDER.terminateAtMs], ...ESCALATION];

export type LadderAim = {
  readonly send: (step: StopStep) => Effect.Effect<void>;
  readonly gone: Effect.Effect<boolean>;
};

export type Climb = {
  readonly steps: ReadonlyArray<StopStep>;
  readonly endedAt: ReadonlyArray<EndedAt | undefined>;
  readonly opened: boolean;
};

const SETTLE_FIRST_MS = 5;
const SETTLE_CAP_MS = 50;

const settle = (ms: number) => Effect.promise(() => Bun.sleep(ms));

export const climb = Effect.fn('executions.climb')(function* (
  first: Opening,
  aims: ReadonlyArray<LadderAim>,
  opening: Effect.Effect<void> = Effect.void,
) {
  const endedAt: Array<EndedAt | undefined> = aims.map(() => undefined);
  const steps: StopStep[] = [];
  const read = Effect.fnUntraced(function* (at: EndedAt) {
    let standing = false;
    for (const [index, aim] of aims.entries()) {
      if (endedAt[index] !== undefined) continue;
      if (yield* aim.gone) endedAt[index] = at;
      else standing = true;
    }
    return !standing;
  });
  const ladder = ladderFrom(first);
  const started = performance.now();
  const deadline = ladder[ladder.length - 1]![1];
  let opens: Fiber.Fiber<void> | undefined;
  let over = yield* read('unsignalled');
  for (const [index, [step, until]] of ladder.entries()) {
    if (!over) {
      yield* Effect.forEach(
        aims.filter((_, at) => endedAt[at] === undefined),
        (aim) => aim.send(step),
        { discard: true },
      );
      steps.push(step);
    }
    if (index === 0) opens = yield* Effect.forkChild(opening);
    let wait = SETTLE_FIRST_MS;
    while (!over && performance.now() - started < until) {
      yield* settle(Math.max(1, Math.min(wait, until - (performance.now() - started))));
      wait = Math.min(wait * 2, SETTLE_CAP_MS);
      over = yield* read(step);
    }
    if (over) break;
  }
  const opened =
    opens === undefined
      ? false
      : Option.isSome(yield* Fiber.await(opens).pipe(Effect.timeoutOption(Math.max(0, deadline - (performance.now() - started)))));
  return { steps, endedAt, opened };
});
