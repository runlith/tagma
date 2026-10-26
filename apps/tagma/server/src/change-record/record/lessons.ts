import { Deferred, Effect, Queue } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { commandSignature, lessonWrites, type SignatureRun } from '../store/commandTables.js';
import type { Learned } from './roles.js';

export const READER_RUNS = 5;

export const WRITER_HITS = 2;

export type Lesson =
  | { readonly kind: 'clean'; readonly signatures: readonly string[] }
  | { readonly kind: 'hit'; readonly signature: string; readonly path: string; readonly at: number };

type Standing = {
  readonly runs: readonly SignatureRun[];
  readonly streak: number;
  readonly hitAt: number | null;
  readonly hitPath: string | null;
};

type Taught = { readonly repository: string; readonly lesson: Lesson; readonly done: Deferred.Deferred<void> };

const FRESH: Standing = { runs: [], streak: 0, hitAt: null, hitPath: null };

const keyOf = (repository: string, signature: string): string => `${repository}\0${signature}`;

const learnedOf = (standing: Standing | undefined): Learned | null =>
  standing === undefined
    ? null
    : standing.runs.filter((run) => run === 'hit').length >= WRITER_HITS
      ? 'writer'
      : standing.streak >= READER_RUNS
        ? 'reader'
        : null;

const after = (standing: Standing, run: SignatureRun, hit: { readonly path: string; readonly at: number } | null): Standing => ({
  runs: [...standing.runs, run].slice(-READER_RUNS),
  streak: run === 'hit' ? 0 : standing.streak + 1,
  hitAt: hit?.at ?? standing.hitAt,
  hitPath: hit?.path ?? standing.hitPath,
});

const runsOf = (lesson: Lesson): readonly { readonly signature: string; readonly run: SignatureRun }[] =>
  lesson.kind === 'hit'
    ? [{ signature: lesson.signature, run: 'hit' }]
    : lesson.signatures.map((signature) => ({ signature, run: 'clean' }));

type Shift = Learned | 'given';

const SHIFT_SPANS: Readonly<Record<Shift, string>> = {
  reader: 'CommandLesson.reader',
  writer: 'CommandLesson.writer',
  given: 'CommandLesson.given',
};

export type Lessons = Effect.Success<typeof makeLessons>;

export const makeLessons = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const roots = yield* FileRoots;
  const known = new Map<string, Standing>();
  const repositories = new Map<string, string | null>();
  const lane = yield* Queue.unbounded<Taught>();
  let last: Deferred.Deferred<void> | null = null;
  for (const row of yield* units.read((unit) => unit.run(store.db.select().from(commandSignature)))) {
    known.set(keyOf(row.repository, row.signature), { runs: row.runs, streak: row.streak, hitAt: row.hitAt, hitPath: row.hitPath });
  }

  const repositoryOf = (checkout: string): Effect.Effect<string | null> =>
    repositories.has(checkout)
      ? Effect.succeed(repositories.get(checkout) ?? null)
      : roots.read(RootId.make(checkout)).pipe(
          Effect.map((root) => {
            const repository = root.git?.repositoryId ?? null;
            repositories.set(checkout, repository);
            return repository;
          }),
          Effect.catchTags({
            RootMissing: (failure) => unplaced(checkout, failure.message),
            RootUnavailable: (failure) => unplaced(checkout, failure.message),
            RootInvalid: (failure) => unplaced(checkout, failure.message),
            RootConflict: (failure) => unplaced(checkout, failure.message),
            RootRefused: (failure) => unplaced(checkout, failure.message),
          }),
        );

  const unplaced = (checkout: string, reason: string): Effect.Effect<null> =>
    Effect.as(Effect.logWarning('a command checkout names no repository, so this command teaches nothing', { checkout, reason }), null);

  const teach = Effect.fn('CommandLessons.teach')(function* ({ repository, lesson }: Taught) {
    const standing = runsOf(lesson).map(({ signature, run }) => {
      const was = known.get(keyOf(repository, signature));
      return { signature, was, now: after(was ?? FRESH, run, lesson.kind === 'hit' ? lesson : null) };
    });
    yield* units.write(lessonWrites, (unit) =>
      Effect.forEach(
        standing,
        ({ signature, now }) =>
          unit.run(
            store.db
              .insert(commandSignature)
              .values({ repository, signature, ...now })
              .onConflictDoUpdate({ target: [commandSignature.repository, commandSignature.signature], set: now }),
          ),
        { discard: true },
      ),
    );
    for (const { signature, was, now } of standing) {
      known.set(keyOf(repository, signature), now);
      const learned = learnedOf(now);
      if (learned !== learnedOf(was)) yield* Effect.withSpan(Effect.void, SHIFT_SPANS[learned ?? 'given']);
    }
  });

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.flatMap(Queue.take(lane), (taught) =>
        teach(taught).pipe(
          Effect.catchTag(['EffectDrizzleQueryError', 'SqlError'], (failure) =>
            Effect.logWarning('a command lesson was not kept; its signatures learn again from the next runs', { reason: failure.message }),
          ),
          Effect.ensuring(Deferred.succeed(taught.done, undefined)),
        ),
      ),
    ),
  );

  return {
    ready: Effect.suspend(() => (last === null ? Effect.void : Deferred.await(last))),
    learned:
      (repository: string | null) =>
      (signature: string): Learned | null =>
        repository === null ? null : learnedOf(known.get(keyOf(repository, signature))),
    repositoryOf,
    taught: Effect.fnUntraced(function* (checkout: string, lesson: Lesson) {
      const repository = yield* repositoryOf(checkout);
      if (repository === null) return;
      const done = yield* Deferred.make<void>();
      last = done;
      yield* Queue.offer(lane, { repository, lesson, done });
    }),
  };
});
