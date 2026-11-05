import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Data, Effect, Result, Schema } from 'effect';
import { type ChainLoss, type ChainTarget, chainFits, returnToChain } from '@runlith/sqlite-process/chainReturn';
import { prepareEngine, selectEngine } from '@runlith/sqlite-process/engine';
import type { Words } from '../../platform/contract/wire/refusal.js';
import { cloneFile, type DurableWriteFailed, moveFile, removeFile } from '../../platform/durable/files.js';
import { currentVersion } from '../../platform/lock/versionedDirectories.js';
import { clearStepBack, readAttempt, readStepBack, writeAttempt, writeStepBack, askedStepBack } from '../closure/attempt.js';
import { carriedOnto, moving, undoneOnto } from '../closure/moves.js';
import { STEP_BACK_SUFFIX, type StepBack } from '../contract/wire/stepBack.js';

export type StoreFile = { readonly path: string; readonly chain: string };

class StepBackFailed extends Data.TaggedError('StepBackFailed')<{ readonly detail: string; readonly words?: Words }> {
  override get message(): string {
    return this.detail;
  }
}

export type ReturnPlace = {
  readonly installRoot: string;
  readonly own: string;
  readonly ownRoot: string;
  readonly files: () => readonly StoreFile[];
};

const SIDES = ['-wal', '-shm'] as const;

const receiptSchema = Schema.fromJsonString(
  Schema.Struct({
    chain: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
    tail: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
  }),
);

const decodeReceipt = Schema.decodeUnknownResult(receiptSchema);

const chainTarget = (folder: string): ChainTarget => {
  const receiptAt = join(folder, 'baseline.json');
  const receipt = existsSync(receiptAt) ? decodeReceipt(readFileSync(receiptAt, 'utf8')) : null;
  const folded = receipt === null || Result.isFailure(receipt) ? [] : [...receipt.success.chain, ...receipt.success.tail];
  return { steps: readMigrationFiles({ migrationsFolder: folder }), accepted: new Map(folded.map(({ name, hash }) => [name, hash])) };
};

const foldLog = (path: string): void => {
  const db = new Database(path);
  try {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
};

const copied = Effect.fnUntraced(function* (path: string) {
  foldLog(path);
  yield* removeFile(`${path}${STEP_BACK_SUFFIX}`);
  yield* cloneFile(path, `${path}${STEP_BACK_SUFFIX}`);
});

const failedOf = (detail: string, cause: unknown): StepBackFailed =>
  new StepBackFailed({ detail: `${detail}: ${cause instanceof Error ? cause.message : String(cause)}` });

const snapshotsDropped = (path: string): void => {
  for (const at of [`${path}.snapshot.json`, `${path}.snapshots`]) rmSync(at, { recursive: true, force: true });
};

const returnedFile = Effect.fnUntraced(function* (file: StoreFile, toRoot: string, fromRoot: string) {
  const { path, chain } = file;
  const folder = join(toRoot, chain);
  if (!existsSync(path) || !existsSync(folder)) return [];
  const target = yield* Effect.try({
    try: () => chainTarget(folder),
    catch: (cause) => failedOf(`the migrations of ${folder} could not be read`, cause),
  });
  const fits = yield* Effect.try({ try: () => chainFits(path, target), catch: (cause) => failedOf(`${path} could not be read`, cause) });
  if (fits) return [];
  yield* copied(path).pipe(
    Effect.catchTag('DurableWriteFailed', (failure: DurableWriteFailed) =>
      Effect.sync(() => console.error(`[tagma] ${path} goes back without a copy of its data: ${failure.reason}`)),
    ),
  );
  const leaving = join(fromRoot, chain);
  const answer = yield* Effect.try({
    try: () =>
      returnToChain(path, target, {
        steps: existsSync(leaving) ? readMigrationFiles({ migrationsFolder: leaving }) : [],
        folder: existsSync(leaving) ? leaving : null,
      }),
    catch: (cause) => failedOf(`${path} could not be returned`, cause),
  });
  if (answer.returned) snapshotsDropped(path);
  return answer.lost.map((loss): ChainLoss => ({ ...loss, table: `${basename(path)} ${loss.table}` }));
});

const restored = Effect.fnUntraced(function* (files: readonly StoreFile[]) {
  for (const { path } of files) {
    if (!existsSync(`${path}${STEP_BACK_SUFFIX}`)) continue;
    for (const side of SIDES) yield* removeFile(`${path}${side}`);
    yield* moveFile(`${path}${STEP_BACK_SUFFIX}`, path);
  }
});

const copiesDropped = (files: readonly StoreFile[]): Effect.Effect<void> =>
  Effect.forEach(files, ({ path }) => removeFile(`${path}${STEP_BACK_SUFFIX}`), { discard: true }).pipe(
    Effect.catchTag('DurableWriteFailed', (failure) =>
      Effect.sync(() =>
        console.error(`[tagma] the copies kept for the step back were not all removed: ${failure.path}: ${failure.reason}`),
      ),
    ),
  );

const returned = Effect.fn('installation.returnStores')(function* (place: ReturnPlace, back: StepBack) {
  const files = place.files();
  yield* Effect.tryPromise({ try: prepareEngine, catch: (cause) => failedOf('the SQLite engine could not be prepared', cause) });
  yield* Effect.try({ try: selectEngine, catch: (cause) => failedOf('the SQLite engine could not be selected', cause) });
  const toRoot = join(place.installRoot, back.to);
  const carried = yield* Effect.forEach(files, (file) => returnedFile(file, toRoot, place.ownRoot));
  for (const loss of carried.flat())
    console.error(`[tagma] the step back to ${back.to} left out ${loss.rows} rows of ${loss.table}: its build cannot hold them`);
});

const failedRecord = (back: StepBack, failure: StepBackFailed): StepBack => ({
  from: back.from,
  to: back.to,
  carried: false,
  failed: { detail: failure.detail, words: failure.words },
});

const THE_TARGET_LEFT = (to: string): string => `release ${to} did not start, so the data went back as it stood`;

const unwound = Effect.fn('installation.stepBackUnwound')(function* (place: ReturnPlace, back: StepBack, detail: string, words?: Words) {
  yield* restored(place.files()).pipe(
    Effect.catchTag('DurableWriteFailed', (failure: DurableWriteFailed) =>
      Effect.sync(() => console.error(`[tagma] the data from before the step back did not come back: ${failure.path}: ${failure.reason}`)),
    ),
  );
  yield* moving(place.installRoot, (lock) =>
    Effect.gen(function* () {
      yield* undoneOnto(lock, place.own);
      const open = readAttempt(place.installRoot);
      if (Result.isSuccess(open) && open.success?.to === back.to && open.success.ended === null)
        writeAttempt(place.installRoot, { ...open.success, ended: { detail, data: 'restored', words } });
      writeStepBack(place.installRoot, failedRecord(back, new StepBackFailed({ detail, words })));
    }),
  );
  console.error(`[tagma] the step back to ${back.to} did not land, and this build keeps serving: ${detail}`);
});

export const stepBackAsked = (installRoot: string, own: string): StepBack | null => {
  const asked = askedStepBack(installRoot);
  return asked !== null && asked.from === own && asked.to !== own ? asked : null;
};

export const stepBackSettled = Effect.fn('installation.stepBackSettled')(function* (place: ReturnPlace) {
  const read = readStepBack(place.installRoot);
  if (Result.isFailure(read)) {
    console.error(`[tagma] ${read.failure.message}; the step back it named is given up`);
    clearStepBack(place.installRoot);
    return;
  }
  const record = read.success;
  if (record === null || record.failed !== undefined) return;
  if (!record.carried) {
    if (askedStepBack(place.installRoot) === null) clearStepBack(place.installRoot);
    return;
  }
  const open = readAttempt(place.installRoot);
  if (Result.isFailure(open)) {
    console.error(`[tagma] the step back to ${record.to} settles once the update record is set aside: ${open.failure.message}`);
    return;
  }
  const attempt = open.success;
  if (record.to === place.own) {
    if (attempt === null) {
      yield* copiesDropped(place.files());
      clearStepBack(place.installRoot);
    }
    return;
  }
  if (attempt !== null && attempt.to === record.to) {
    yield* unwound(place, record, attempt.ended?.detail ?? THE_TARGET_LEFT(record.to), attempt.ended?.words);
    return;
  }
  yield* copiesDropped(place.files());
  clearStepBack(place.installRoot);
});

export const stepBackCarried = Effect.fn('installation.stepBackCarried')(function* (place: ReturnPlace, back: StepBack) {
  const moved = moving(place.installRoot, (lock) => carriedOnto(lock, back, place.own)).pipe(
    Effect.mapError(
      (failure) =>
        new StepBackFailed({
          detail: `release ${back.to} could not be made current: ${failure._tag === 'InstallHeld' ? `${failure.path}: ${failure.reason}` : `${failure.step}: ${failure.detail}`}`,
        }),
    ),
  );
  const carried = yield* Effect.result(Effect.andThen(returned(place, back), moved));
  if (Result.isFailure(carried)) {
    yield* unwound(place, back, carried.failure.detail, carried.failure.words);
    return false;
  }
  return true;
});

export const stepBackHanded = Effect.fn('installation.stepBackHanded')(function* (place: ReturnPlace, back: StepBack, detail: string) {
  yield* unwound(place, back, detail);
});

export const stepBackUnlisted = Effect.fn('installation.stepBackUnlisted')(function* (
  installRoot: string,
  back: StepBack,
  failure: { readonly message: string },
) {
  const detail = `the execution hosts could not be listed: ${failure.message}`;
  yield* moving(installRoot, () => Effect.sync(() => writeStepBack(installRoot, failedRecord(back, new StepBackFailed({ detail })))));
  console.error(`[tagma] the step back to ${back.to} did not start, and this build keeps serving: ${detail}`);
});

export const stepBackPassed = Effect.fn('installation.stepBackPassed')(function* (place: ReturnPlace, back: StepBack) {
  const open = readAttempt(place.installRoot);
  if (Result.isFailure(open) || open.success !== null || currentVersion(place.installRoot) !== back.to) return;
  yield* copiesDropped(place.files());
  clearStepBack(place.installRoot);
});

export const stepBackFailure = (installRoot: string): NonNullable<StepBack['failed']> | null => {
  const read = readStepBack(installRoot);
  if (Result.isFailure(read) || read.success === null || read.success.failed === undefined) return null;
  clearStepBack(installRoot);
  return read.success.failed;
};
