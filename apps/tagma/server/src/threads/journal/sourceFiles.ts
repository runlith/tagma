import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { cloneFile } from '../../platform/durable/files.js';
import type { PublishedSource, RolloutFiles, SourceOrigin } from '../contract/service/rested.js';
import { threadPublishedSource } from '../store/journal.js';
import { conversationCleared } from './conversationIndex.js';
import { RolloutUnreadable } from './rolloutFile.js';
import { rolloutFiles, rolloutStateOf } from './rolloutForms.js';
import type { NativeFolds } from './rolloutMeta.js';
import type { SourceRetention } from './sourceRetention.js';

type SourceCandidate =
  | { readonly kind: 'current' }
  | { readonly kind: 'staged'; readonly path: string; readonly representation: 'plain' | 'compressed'; readonly replaces: boolean };

const fileWitness = Effect.fnUntraced(function* (path: string, form: 'plain' | 'compressed') {
  const file = yield* Effect.tryPromise({
    try: () => stat(path, { bigint: true }),
    catch: (cause) => new RolloutUnreadable({ reason: 'io', path, message: cause instanceof Error ? cause.message : String(cause) }),
  });
  return `${form}:${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}`;
});

const sourceWitness = Effect.fnUntraced(function* (canonical: string) {
  const state = yield* rolloutStateOf(canonical);
  return state === null ? null : yield* fileWitness(state.path, state.form);
});

export const sourcePath = (canonical: string, generation: string): string => join(`${canonical}.generations`, `${generation}.jsonl`);

export const sourceFiles = (canonical: string, source: PublishedSource): RolloutFiles =>
  rolloutFiles(sourcePath(canonical, source.generation));

type SourceStage = {
  readonly canonical: string;
  readonly candidate: SourceCandidate;
  readonly form: string | null;
  readonly origin: SourceOrigin;
};

const stageSource = Effect.fnUntraced(function* (input: SourceStage, folds: NativeFolds) {
  const generation = randomUUID();
  const target = sourcePath(input.canonical, generation);
  const remove = Effect.promise(() => rm(target, { force: true }));
  const io = (message: string) => new RolloutUnreadable({ reason: 'io', path: target, message });
  return yield* Effect.gen(function* () {
    const basis = yield* sourceWitness(input.canonical);
    if (basis === null && (input.candidate.kind === 'current' || !input.candidate.replaces))
      return yield* io('the canonical rollout is missing');
    const state =
      input.candidate.kind === 'current'
        ? yield* rolloutStateOf(input.canonical)
        : { path: input.candidate.path, form: input.candidate.representation };
    if (state === null) return yield* io('the source rollout is missing');
    const stagedWitness = input.candidate.kind === 'staged' ? yield* fileWitness(state.path, state.form) : null;
    const extracting = `${input.canonical}.extract-${generation}`;
    const extracted = `${extracting}.source`;
    const removeExtracted = Effect.promise(async () => {
      await rm(extracted, { force: true });
      await rm(`${extracting}.zst.source`, { force: true });
    });
    const staging =
      state.form === 'compressed'
        ? yield* folds
            .stage(
              { path: extracting, packed: state.path, transcript: `${extracting}.entries` },
              { form: 'compressed', wanted: [], steps: [], suffix: '.source' },
            )
            .pipe(Effect.onError(() => removeExtracted))
        : null;
    if (staging?.kind === 'unformable') {
      yield* removeExtracted;
      return yield* io(staging.reason);
    }
    if (staging?.kind === 'staged' && staging.changed) {
      yield* removeExtracted;
      return yield* io('extracting the rollout changed its records');
    }
    const from = staging === null ? state.path : staging.staged;
    const durability = yield* cloneFile(from, target).pipe(
      Effect.mapError((cause) => io(cause.reason)),
      Effect.ensuring(staging === null ? Effect.void : removeExtracted),
    );
    if (durability !== 'full') return yield* io('a full flush is unavailable for the published source');
    const frontier = yield* folds.certify(rolloutFiles(target));
    if ((yield* sourceWitness(input.canonical)) !== basis) return yield* io('the canonical rollout changed while its source was prepared');
    if (stagedWitness !== null && (yield* fileWitness(state.path, state.form)) !== stagedWitness)
      return yield* io('the staged rollout changed while its source was prepared');
    return { ...frontier, generation, form: input.form, origin: input.origin } satisfies PublishedSource;
  }).pipe(Effect.onError(() => remove));
});

const retireSource = (retention: SourceRetention, threadId: string, canonical: string, source: PublishedSource) => {
  const old = sourceFiles(canonical, source);
  return retention
    .retire(threadId, [old.path, old.packed, old.transcript, `${old.transcript}.partial`])
    .pipe(Effect.catchCause((cause) => Effect.logError(`The retired source of ${threadId} could not be removed`, cause)));
};

const withdrawSourceIn = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  retention: SourceRetention,
  threadId: string,
  canonical: string,
): Effect.fn.Return<void, StoreFailure> {
  const previous = yield* unit.run(db.select().from(threadPublishedSource).where(eq(threadPublishedSource.threadId, threadId)).get());
  if (previous === undefined) return;
  yield* unit.run(db.delete(threadPublishedSource).where(eq(threadPublishedSource.threadId, threadId)));
  yield* unit.afterCommit(retireSource(retention, threadId, canonical, previous));
});

const publishSourceIn = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  retention: SourceRetention,
  threadId: string,
  canonical: string,
  source: PublishedSource,
): Effect.fn.Return<void, StoreFailure> {
  const previous = yield* unit.run(db.select().from(threadPublishedSource).where(eq(threadPublishedSource.threadId, threadId)).get());
  yield* unit.run(
    db
      .insert(threadPublishedSource)
      .values({ threadId, ...source })
      .onConflictDoUpdate({ target: threadPublishedSource.threadId, set: source }),
  );
  if (previous !== undefined && previous.factFingerprint !== source.factFingerprint) yield* conversationCleared(db, unit, threadId);
  if (previous !== undefined && previous.generation !== source.generation) {
    yield* unit.afterCommit(retireSource(retention, threadId, canonical, previous));
  }
});

export type SourcePublication = ReturnType<typeof sourcePublication>;

export const sourcePublication = (folds: NativeFolds, retention: SourceRetention) => ({
  using: retention.using,
  stage: (input: SourceStage) => stageSource(input, folds),
  digest: (path: string) => folds.digest(rolloutFiles(path), 'plain'),
  publishIn: (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, threadId: string, canonical: string, source: PublishedSource) =>
    publishSourceIn(db, unit, retention, threadId, canonical, source),
  withdrawIn: (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, threadId: string, canonical: string) =>
    withdrawSourceIn(db, unit, retention, threadId, canonical),
  discard: (threadId: string, canonical: string, source: PublishedSource) => {
    const files = sourceFiles(canonical, source);
    return retention
      .retire(threadId, [files.path, files.packed, files.transcript, `${files.transcript}.partial`])
      .pipe(
        Effect.mapError(
          (cause) =>
            new RolloutUnreadable({ reason: 'io', path: files.path, message: cause instanceof Error ? cause.message : String(cause) }),
        ),
      );
  },
});
