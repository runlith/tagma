import { type Assembled, relevant } from '@tagma/inspection/builtins';
import type { Reading } from '@tagma/inspection/node/reading';
import { mergeSlices, schedule, type Scope } from '@tagma/inspection/node/slices';
import type { Verdict } from '@tagma/inspection/verdict';
import { randomUUID } from 'node:crypto';
import { Effect, Result } from 'effect';
import type { InspectionFailure } from '../contract/wire/enforcement.js';
import type { Installed } from '@runlith/code-facts/tree';
import type { Compared, InspectionAnswer, Installs, JudgeRequest, ReachRequest, WorkerAsk } from './asks.js';

export type Answered = Extract<InspectionAnswer, { readonly answered: true }>;
type Failure = { readonly cause: InspectionFailure; readonly reason: string; readonly split?: true };
type Failing<E> = (cause: InspectionFailure, reason: string) => E;
type Answer<E> = (ask: WorkerAsk) => Effect.Effect<Answered, E>;
type Subject = {
  readonly root: string;
  readonly commit: string;
  readonly inspection: Assembled;
  readonly places: readonly string[];
  readonly job: string;
  readonly measures?: true;
  readonly compared?: Compared;
  readonly installed?: Installs;
  readonly checkout?: string;
};
type Judged = { readonly verdict: Verdict; readonly read: readonly string[]; readonly ms: number };
type Held = { readonly commit: string; readonly reading: Reading; readonly headroom: number; readonly installed: Installs };

const partsOf = (scope: Scope): string =>
  scope.parts === 'whole' ? 'every package' : scope.parts.map((part) => part.package ?? 'files outside every package').join(', ');

export const slicedReading = Effect.fnUntraced(function* <E extends Failure>(
  answer: Answer<E>,
  subject: Subject,
  failing: Failing<E>,
  from?: Held,
) {
  const pinned = new Map(subject.installed ?? []);
  const used = new Map<string, Installed | null>();
  const take = (installs: Installs): void => {
    for (const [path, file] of installs) {
      pinned.set(path, file);
      used.set(path, file);
    }
  };
  const planned = yield* answer({
    kind: 'plan',
    root: subject.root,
    commit: subject.commit,
    inspection: subject.inspection,
    places: subject.places,
    job: subject.job,
    measures: subject.measures,
    from: from === undefined ? undefined : { commit: from.commit, headroom: from.headroom },
    compared: subject.compared,
    installed: [...pinned],
    checkout: subject.checkout,
  });
  if (!('compared' in planned)) return yield* Effect.fail(failing('worker', 'the inspection worker answered a plan ask without a plan'));
  const { compared } = planned;
  take(planned.installed);
  if ('reading' in planned)
    return { reading: planned.reading, read: planned.read, compared, headroom: planned.headroom, installed: [...used] };
  if ('same' in planned) {
    if (from === undefined)
      return yield* Effect.fail(failing('worker', 'the inspection worker carried a reading nobody asked it to carry'));
    take(from.installed);
    return { reading: from.reading, read: planned.read, compared, headroom: planned.headroom, installed: [...used] };
  }
  const { headroom } = planned.plan;
  const read = new Set(planned.read);
  const run = schedule(planned.plan);
  for (let step = run.next(); step !== undefined; step = run.next()) {
    const { scope } = step;
    const served = yield* Effect.result(
      answer({
        kind: 'slice',
        root: subject.root,
        commit: subject.commit,
        inspection: subject.inspection,
        places: subject.places,
        scope,
        job: subject.job,
        measures: subject.measures,
        compared,
        installed: [...pinned],
        checkout: subject.checkout,
      }),
    );
    if (Result.isFailure(served)) {
      const failed = served.failure;
      if (failed.split === true) {
        yield* Effect.logDebug('a slice is too large to judge whole, so it is split', { reason: failed.reason });
        yield* Effect.try({
          try: () => run.split(step),
          catch: (error) => failing('source', error instanceof Error ? error.message : String(error)),
        });
        continue;
      }
      return yield* Effect.fail(
        failing(failed.cause, `the slice of ${partsOf(scope)} at ${subject.commit} could not be judged: ${failed.reason}`),
      );
    }
    const reply = served.success;
    if (!('sliced' in reply)) return yield* Effect.fail(failing('worker', 'the inspection worker answered a slice ask without a slice'));
    for (const path of reply.read) read.add(path);
    take(reply.installed);
    const sliced = reply.sliced;
    yield* Effect.try({
      try: () => run.answer(step, sliced),
      catch: (error) => failing('source', error instanceof Error ? error.message : String(error)),
    });
  }
  return { reading: mergeSlices(run.readings()), read: [...read], compared, headroom, installed: [...used] };
});

export const slicedReach = Effect.fnUntraced(function* <E extends Failure>(
  answer: Answer<E>,
  message: Omit<ReachRequest, 'kind'>,
  failing: Failing<E>,
) {
  const started = performance.now();
  const { reading, read } = yield* slicedReading(answer, { ...message, job: randomUUID(), measures: true }, failing);
  return { verdict: reading, read, ms: Math.round(performance.now() - started) } satisfies Judged;
});

export const slicedJudge = Effect.fnUntraced(function* <E extends Failure>(
  answer: Answer<E>,
  message: Omit<JudgeRequest, 'kind'>,
  failing: Failing<E>,
) {
  const started = performance.now();
  if (!message.paths.some((path) => relevant(message.inspection, path)))
    return { verdict: { violations: [], unjudged: [] }, read: [], ms: 0 } satisfies Judged;
  const job = randomUUID();
  const at = { root: message.root, inspection: message.inspection, places: message.places, job, checkout: message.checkout };
  const base = yield* slicedReading(answer, { ...at, commit: message.base }, failing);
  const { compared } = base;
  const built = yield* slicedReading(answer, { ...at, commit: message.built, compared, installed: base.installed }, failing, {
    commit: message.base,
    reading: base.reading,
    headroom: base.headroom,
    installed: base.installed,
  });
  const readings = {
    base: base.reading,
    built: built.reading,
    compared,
    installed: { base: base.installed, built: built.installed },
    headroom: { base: base.headroom, built: built.headroom },
  };
  const judged = yield* answer({ ...message, kind: 'judge', readings });
  if (!('verdict' in judged)) return yield* Effect.fail(failing('worker', 'the inspection worker answered a judge ask without a verdict'));
  const read = [...new Set([...base.read, ...built.read, ...judged.read])];
  return { verdict: judged.verdict, read, ms: Math.round(performance.now() - started) } satisfies Judged;
});
