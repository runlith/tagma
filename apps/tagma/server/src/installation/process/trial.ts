import { Database } from 'bun:sqlite';
import { constants, copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Data, Effect, Option, Predicate, Result, Schema } from 'effect';
import { type Words, wordsSchema } from '../../platform/contract/wire/refusal.js';
import { cloneFile, moveFile, removeFile, replaceFile } from '../../platform/durable/files.js';
import { dataSpaceWords } from '../../platform/durable/space.js';
import { passAttempt, readAttempt, writeAttempt } from '../closure/attempt.js';
import { currentVersion, swapCurrent } from '../closure/versions.js';
import { ATTEMPT_STARTS, type Attempt, type AttemptEnd } from '../contract/wire/attempt.js';

const KEPT = '.attempt';
const RETURNING = '.returning';
const SIDES = ['-wal', '-shm'] as const;

export type Trial = {
  readonly settled: () => boolean;
  readonly passed: Effect.Effect<void>;
  readonly closing: (close: Effect.Effect<void>) => void;
  readonly failed: (detail: string, words?: Words) => Effect.Effect<void>;
};

export type TrialPlace = {
  readonly installRoot: string;
  readonly release: string | undefined;
  readonly files: readonly string[];
};

export class TrialRefused extends Data.TaggedError('TrialRefused')<{ readonly detail: string; readonly words?: Words }> {}

const decodeWords = Schema.decodeUnknownOption(wordsSchema);

export const wordsOf = (failure: unknown): Words | undefined =>
  Predicate.hasProperty(failure, 'words') ? Option.getOrUndefined(decodeWords(failure.words)) : undefined;

const realOr = (path: string): string => (existsSync(path) ? realpathSync(path) : path);

const ownVersion = ({ installRoot, release }: TrialPlace): string | null => {
  if (release === undefined) return null;
  const root = realOr(release);
  return dirname(root) === realOr(installRoot) ? basename(root) : null;
};

const kept = Effect.fnUntraced(function* (path: string) {
  for (const side of ['', ...SIDES]) {
    const at = `${path}${side}`;
    yield* removeFile(`${at}${KEPT}`);
    if (existsSync(at)) yield* cloneFile(at, `${at}${KEPT}`);
    else if (side === '') yield* replaceFile(`${at}${KEPT}`, '');
  }
});

const put = Effect.fnUntraced(function* (from: string, to: string) {
  yield* removeFile(`${to}${RETURNING}`);
  yield* cloneFile(from, `${to}${RETURNING}`);
  yield* moveFile(`${to}${RETURNING}`, to);
});

const returned = Effect.fnUntraced(function* (path: string) {
  if (!existsSync(`${path}${KEPT}`)) return;
  for (const side of SIDES) yield* removeFile(`${path}${side}`);
  if (statSync(`${path}${KEPT}`).size === 0) yield* removeFile(path);
  else yield* put(`${path}${KEPT}`, path);
  for (const side of SIDES) if (existsSync(`${path}${side}${KEPT}`)) yield* put(`${path}${side}${KEPT}`, `${path}${side}`);
});

const dropped = Effect.fnUntraced(function* (path: string) {
  for (const side of ['', ...SIDES]) {
    yield* removeFile(`${path}${side}${KEPT}`);
    yield* removeFile(`${path}${side}${RETURNING}`);
  }
});

const forEachFile = <E>(files: readonly string[], each: (path: string) => Effect.Effect<void, E>): Effect.Effect<void, E> =>
  Effect.forEach(files, each, { discard: true });

const droppedAll = (files: readonly string[]): Effect.Effect<void> =>
  Effect.flatMap(Effect.result(forEachFile(files, dropped)), (result) =>
    Result.isSuccess(result)
      ? Effect.void
      : Effect.sync(() =>
          console.error(`[tagma] the copies kept for an attempt were not all removed: ${result.failure.path}: ${result.failure.reason}`),
        ),
  );

export const arrive = Effect.fn('Trial.arrive')(function* (place: TrialPlace) {
  const { installRoot } = place;
  const version = ownVersion(place);
  const record = readAttempt(installRoot);
  if (record === null) return 'serve' as const;
  const current = currentVersion(installRoot);
  if (record.to !== version) {
    if (record.ended !== null && current !== record.to) yield* droppedAll(place.files);
    return 'serve' as const;
  }
  if (current !== version) return 'serve' as const;
  if (record.ended !== null) return record.ended.data === 'unrestored' ? ('roll' as const) : ('serve' as const);
  if (record.starts >= ATTEMPT_STARTS) return 'roll' as const;
  writeAttempt(installRoot, { ...record, starts: record.starts + 1 });
  return 'serve' as const;
});

const returnedAll = (place: TrialPlace): Effect.Effect<AttemptEnd['data']> =>
  Effect.map(Effect.result(forEachFile(place.files, returned)), (result) => {
    if (Result.isSuccess(result)) return 'restored';
    console.error(`[tagma] the data of the failed attempt could not be returned: ${result.failure.path}: ${result.failure.reason}`);
    return 'unrestored';
  });

const leftAs = (files: readonly string[]): string =>
  files
    .flatMap((path) => [path, `${path}-wal`])
    .map((path) => {
      const stat = statSync(path, { throwIfNoEntry: false });
      return stat === undefined ? `${path} absent` : `${path} ${stat.ino} ${stat.size} ${stat.mtimeMs}`;
    })
    .join('\n');

const ledgerOf = (main: string, wal: string): string | null => {
  if (!existsSync(main) || statSync(main).size === 0) return null;
  const scratch = mkdtempSync(join(dirname(main), '.ledger-'));
  try {
    const at = join(scratch, 'read.sqlite');
    copyFileSync(main, at, constants.COPYFILE_FICLONE);
    if (existsSync(wal)) copyFileSync(wal, `${at}-wal`, constants.COPYFILE_FICLONE);
    const db = new Database(at);
    try {
      const held = db.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get() !== null;
      return held ? JSON.stringify(db.query('select name, hash from __drizzle_migrations order by id').all()) : '';
    } finally {
      db.close();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

const servedByFrom = (files: readonly string[]): Effect.Effect<boolean> =>
  Effect.map(
    Effect.result(
      Effect.try({
        try: () => files.every((path) => ledgerOf(path, `${path}-wal`) === ledgerOf(`${path}${KEPT}`, `${path}-wal${KEPT}`)),
        catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
      }),
    ),
    (read) => {
      if (Result.isSuccess(read)) return read.success;
      console.error(`[tagma] the migrations standing in the data could not be read, so the copies go back: ${read.failure}`);
      return false;
    },
  );

const settledOn = Effect.fnUntraced(function* (place: TrialPlace, record: Attempt, end: AttemptEnd) {
  const { installRoot } = place;
  if (end.data !== 'unrestored' && record.from !== null && currentVersion(installRoot) === record.to) swapCurrent(installRoot, record.from);
  writeAttempt(installRoot, { ...record, ended: end });
  if (end.data !== 'unrestored') yield* droppedAll(place.files);
  console.error(`[tagma] the attempt on ${record.to} ended before its door opened (${end.data}): ${end.detail}`);
});

export const rollBack = Effect.fn('Trial.rollBack')(function* (place: TrialPlace, detail: string, words?: Words) {
  const version = ownVersion(place);
  const record = readAttempt(place.installRoot);
  if (version === null || record === null || record.to !== version || currentVersion(place.installRoot) !== version) return;
  if (record.ended === null) {
    const data = record.copied ? yield* returnedAll(place) : 'untouched';
    return yield* settledOn(place, record, { detail, data, words, left: data === 'unrestored' ? leftAs(place.files) : undefined });
  }
  if (record.ended.data !== 'unrestored') return;
  const ended = { detail: record.ended.detail, words: record.ended.words };
  if (record.ended.left !== leftAs(place.files) && (yield* servedByFrom(place.files)))
    return yield* settledOn(place, record, { ...ended, data: 'kept' });
  const data = yield* returnedAll(place);
  if (data === 'restored') yield* settledOn(place, record, { ...ended, data });
  else writeAttempt(place.installRoot, { ...record, ended: { ...ended, data, left: leftAs(place.files) } });
});

const copiedAll = (place: TrialPlace): Effect.Effect<void, TrialRefused> =>
  forEachFile(place.files, kept).pipe(
    Effect.mapError(
      (failure) =>
        new TrialRefused({
          detail: `the data was not copied before the attempt: ${failure.path}: ${failure.reason}`,
          words: failure.step === 'space' && failure.needed !== undefined ? dataSpaceWords(failure.needed) : undefined,
        }),
    ),
  );

export const enterTrial = Effect.fn('Trial.enter')(function* (place: TrialPlace) {
  const { installRoot } = place;
  const version = ownVersion(place);
  const record = version === null ? null : readAttempt(installRoot);
  if (version === null || record === null || record.to !== version || record.ended !== null || currentVersion(installRoot) !== version)
    return null;
  if (record.copied)
    yield* forEachFile(place.files, returned).pipe(
      Effect.mapError(
        (failure) => new TrialRefused({ detail: `the data of the earlier start was not returned: ${failure.path}: ${failure.reason}` }),
      ),
    );
  else yield* copiedAll(place);
  writeAttempt(installRoot, { ...record, starts: Math.max(record.starts, 1), copied: true });
  const closings: Effect.Effect<void>[] = [];
  let settled = false;
  const trial: Trial = {
    settled: () => settled,
    passed: Effect.suspend(() => {
      settled = true;
      passAttempt(installRoot, version);
      return droppedAll(place.files);
    }),
    closing: (close) => {
      closings.push(close);
    },
    failed: (detail, words) =>
      Effect.suspend(() => {
        if (settled) return Effect.void;
        settled = true;
        return Effect.andThen(Effect.forEach(closings, Effect.exit, { discard: true }), rollBack(place, detail, words));
      }),
  };
  return trial;
});
