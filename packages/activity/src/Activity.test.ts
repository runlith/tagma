import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Data, Deferred, Effect, Exit, Fiber, Stream } from 'effect';
import { activity, activityStream, note } from './Activity';
import { activityKind, type ActivityEnded, type ActivityFact, type ActivityOpened, type ActivityOutcome } from './fact';
import { ActivityLog } from './log';
import { ActivityCause } from './cause';

class Refused extends Data.TaggedError('Refused')<{ readonly message: string }> {}

const WORK = activityKind<{ readonly step: number }, { readonly answered?: string }>('work');

const recorded = Effect.fnUntraced(function* <A, E>(effect: Effect.Effect<A, E>) {
  const facts: ActivityFact[] = [];
  const exit = yield* Effect.exit(
    effect.pipe(Effect.provideService(ActivityLog, { record: (fact) => void facts.push(fact), settled: Effect.void })),
  );
  return { facts, exit };
});

const endOf = (facts: readonly ActivityFact[]): ActivityEnded => {
  const ended = facts.filter((fact): fact is ActivityEnded => fact._tag === 'Ended');
  expect(ended).toHaveLength(1);
  return ended[0]!;
};

it.effect('the combinator ends every activity it opened with the outcome its work came to', () =>
  Effect.gen(function* () {
    const cases: readonly [string, Effect.Effect<string, Refused>, ActivityOutcome, string | null][] = [
      ['success', Effect.succeed('done'), 'ok', null],
      ['typed failure', Effect.fail(new Refused({ message: 'no' })), 'failed', 'Refused'],
      ['defect', Effect.die(new Error('broken')), 'failed', 'Defect'],
      ['interruption', Effect.interrupt, 'cancelled', 'Interrupted'],
    ];
    for (const [, work, outcome, reason] of cases) {
      const { facts } = yield* recorded(activity(WORK, { step: 1 }, work));
      expect(facts[0]?._tag).toBe('Opened');
      expect({ outcome: endOf(facts).outcome, reason: endOf(facts).reason }).toEqual({ outcome, reason });
    }
  }),
);

it.effect('the ending mapper turns an answered refusal into a refused activity with its result', () =>
  Effect.gen(function* () {
    const { facts } = yield* recorded(
      activity(WORK, { step: 2 }, Effect.succeed({ refused: true, text: 'not allowed' }), {
        ended: (exit) => (Exit.isSuccess(exit) && exit.value.refused ? { outcome: 'refused', result: { answered: exit.value.text } } : {}),
      }),
    );
    expect(endOf(facts)).toMatchObject({ outcome: 'refused', result: { answered: 'not allowed' } });
  }),
);

it.effect('an activity opened inside another names it as parent and inherits its thread and run', () =>
  Effect.gen(function* () {
    const { facts } = yield* recorded(activity(WORK, { step: 1 }, activity(WORK, { step: 2 }, Effect.void), { thread: 't1', run: 'r1' }));
    const [outer, inner] = facts.filter((fact): fact is ActivityOpened => fact._tag === 'Opened');
    expect(inner).toMatchObject({ parent: outer?.id, thread: 't1', run: 'r1' });
  }),
);

it.effect('a root inherits its cause, can name several input identities, or can explicitly open without a trigger', () =>
  Effect.gen(function* () {
    const { facts } = yield* recorded(
      Effect.all([
        activity(WORK, { step: 1 }, Effect.void),
        activity(WORK, { step: 2 }, Effect.void, { trigger: { kind: 'inbox', refs: ['first', 'second'] } }),
        activity(WORK, { step: 3 }, Effect.void, { trigger: null }),
      ]).pipe(Effect.provideService(ActivityCause, { actor: { kind: 'operator' }, trigger: { kind: 'operation', refs: ['start'] } })),
    );
    const opened = facts.filter((fact): fact is ActivityOpened => fact._tag === 'Opened');
    expect(opened.map((fact) => fact.trigger)).toEqual([
      { kind: 'operation', refs: ['start'] },
      { kind: 'inbox', refs: ['first', 'second'] },
      null,
    ]);
  }),
);

it.effect('the stream form ends ok when the stream completes, failed when it fails and cancelled when its consumer is interrupted', () =>
  Effect.gen(function* () {
    const completed = yield* recorded(Stream.runDrain(activityStream(WORK, { step: 1 }, Stream.make(1, 2, 3))));
    expect(endOf(completed.facts).outcome).toBe('ok');

    const failed = yield* recorded(Stream.runDrain(activityStream(WORK, { step: 1 }, Stream.fail(new Refused({ message: 'no' })))));
    expect({ outcome: endOf(failed.facts).outcome, reason: endOf(failed.facts).reason }).toEqual({
      outcome: 'failed',
      reason: 'Refused',
    });

    const interrupted = yield* recorded(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const fiber = yield* Effect.forkChild(
          Stream.runDrain(
            activityStream(WORK, { step: 1 }, Stream.fromEffect(Effect.andThen(Deferred.succeed(started, undefined), Effect.never))),
          ),
        );
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
      }),
    );
    expect(endOf(interrupted.facts).outcome).toBe('cancelled');
  }),
);

it.effect('an ending mapper that throws keeps the outcome of the exit and leaves a note saying why', () =>
  Effect.gen(function* () {
    const { facts } = yield* recorded(
      activity(WORK, { step: 1 }, Effect.fail(new Refused({ message: 'no' })), {
        ended: () => {
          throw new Error('mapper broke');
        },
      }),
    );
    expect(endOf(facts)).toMatchObject({ outcome: 'failed', reason: 'Refused' });
    expect(facts.find((fact) => fact._tag === 'Noted')).toMatchObject({ note: { type: 'ending-failed', message: 'mapper broke' } });
  }),
);

it.effect('a note naming another run goes to that run, not to the activity the fiber inherited', () =>
  Effect.gen(function* () {
    const { facts } = yield* recorded(
      activity(WORK, { step: 1 }, Effect.all([note({ type: 'here' }, { run: 'r1' }), note({ type: 'there' }, { run: 'r2' })]), {
        run: 'r1',
      }),
    );
    const opened = facts.find((fact): fact is ActivityOpened => fact._tag === 'Opened');
    const noted: unknown[] = facts.filter((fact) => fact._tag === 'Noted').map((fact) => fact.activity);
    expect(noted).toEqual([opened?.id, { run: 'r2' }]);
  }),
);
