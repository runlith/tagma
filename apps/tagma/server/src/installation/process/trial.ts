import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Clock, Data, Effect, Option, Predicate, Result, Schema } from 'effect';
import { type Words, wordsSchema } from '../../platform/contract/wire/refusal.js';
import { type CloneFailed, cloneTree } from '../../platform/durable/clone.js';
import { cloneFile, DurableWriteFailed, moveFile, removeFile, replaceFile } from '../../platform/durable/files.js';
import { dataSpaceWords } from '../../platform/durable/space.js';
import { passAttempt, readAttempt, type RecordUnreadable, setAsideAttempt, stands, writeAttempt, writeServed } from '../closure/attempt.js';
import { moving } from '../closure/moves.js';
import { currentVersion, swapCurrent } from '../../platform/lock/versionedDirectories.js';
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
  readonly stores: string | null;
};

const DATABASE = '.sqlite';

const databasesIn = (directory: string | null, suffix: string): readonly string[] =>
  directory === null || !existsSync(directory)
    ? []
    : readdirSync(directory)
        .filter((name) => name.endsWith(`${DATABASE}${suffix}`))
        .sort()
        .map((name) => join(directory, name.slice(0, name.length - suffix.length)));

const covered = (place: TrialPlace): readonly string[] => [...place.files, ...databasesIn(place.stores, KEPT)];

const standing = (place: TrialPlace): readonly string[] => [...place.files, ...databasesIn(place.stores, '')];

const COPIES = ['', ...SIDES].flatMap((side) => [`${side}${KEPT}`, `${side}${RETURNING}`]);

const strays = (place: TrialPlace): readonly string[] => {
  const found = new Set(place.files);
  if (place.stores !== null && existsSync(place.stores))
    for (const name of readdirSync(place.stores)) {
      const suffix = COPIES.find((one) => name.endsWith(`${DATABASE}${one}`));
      if (suffix !== undefined) found.add(join(place.stores, name.slice(0, name.length - suffix.length)));
    }
  return [...found];
};

export class TrialRefused extends Data.TaggedError('TrialRefused')<{ readonly detail: string; readonly words?: Words }> {}

class StartStale extends Data.TaggedError('StartStale')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const staleOf = (record: Attempt | null, current: string | null, version: string | null): StartStale | null =>
  record !== null && stands(record, current) && version !== null && version !== record.to && version !== record.from
    ? new StartStale({
        detail: `release ${version} is not the release that stands: ${record.to} stands as the update from ${record.from ?? 'nothing'}, and only those two open the data until that update ends`,
      })
    : null;

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
  for (const side of [...SIDES, '']) {
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

const copiesLeft = (place: TrialPlace): boolean => strays(place).some((path) => COPIES.some((suffix) => existsSync(`${path}${suffix}`)));

const setAside = Effect.fnUntraced(function* (place: TrialPlace, unreadable: RecordUnreadable) {
  const stamp = yield* Clock.currentTimeMillis;
  const copies = strays(place)
    .flatMap((path) => COPIES.map((suffix) => `${path}${suffix}`))
    .filter((copy) => existsSync(copy));
  const moved = yield* Effect.result(
    forEachFile(copies, (copy) => moveFile(copy, `${copy}.unread-${stamp}`)).pipe(
      Effect.andThen(
        Effect.try({
          try: () => setAsideAttempt(place.installRoot, stamp),
          catch: (cause) => new DurableWriteFailed({ path: unreadable.path, step: 'rename', reason: String(cause) }),
        }),
      ),
    ),
  );
  console.error(
    Result.isSuccess(moved)
      ? `[tagma] ${unreadable.message}; it and the ${copies.length} data copies it may name are set aside as *.unread-${stamp}, and this start serves with no update attempt`
      : `[tagma] ${unreadable.message}; it could not be set aside (${moved.failure.path}: ${moved.failure.reason}), so it and every copy stay and the next start tries again`,
  );
  return 'serve' as const;
});

const admitted = Effect.fnUntraced(function* (place: TrialPlace) {
  const { installRoot } = place;
  const version = ownVersion(place);
  const read = readAttempt(installRoot);
  if (Result.isFailure(read)) return yield* setAside(place, read.failure);
  const record = read.success;
  const current = currentVersion(installRoot);
  const standing = record !== null && stands(record, current);
  if (!standing || !record.copied) yield* droppedAll(strays(place));
  if (record === null) return 'serve' as const;
  if (staleOf(record, current, version) !== null) return 'stale' as const;
  if (record.to !== version) return 'serve' as const;
  if (current !== version) return 'serve' as const;
  if (record.ended !== null) return record.ended.data === 'unrestored' ? ('roll' as const) : ('serve' as const);
  if (record.starts >= ATTEMPT_STARTS) return 'roll' as const;
  writeAttempt(installRoot, { ...record, starts: record.starts + 1 });
  return 'serve' as const;
});

export const arrive = Effect.fn('Trial.arrive')(function* (place: TrialPlace) {
  const read = readAttempt(place.installRoot);
  if (Result.isSuccess(read) && read.success === null && !copiesLeft(place)) return 'serve' as const;
  return yield* moving(place.installRoot, () => admitted(place));
});

const returnedAll = (place: TrialPlace): Effect.Effect<AttemptEnd['data']> =>
  Effect.map(Effect.result(forEachFile(covered(place), returned)), (result) => {
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

class LedgerUnread extends Data.TaggedError('LedgerUnread')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

const migrationsIn = (at: string): string => {
  const db = new Database(at);
  try {
    const held = db.query("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get() !== null;
    return held ? JSON.stringify(db.query('select name, hash from __drizzle_migrations order by id').all()) : '';
  } finally {
    db.close();
  }
};

const ledgerOf = Effect.fnUntraced(function* (main: string, wal: string) {
  if (!existsSync(main) || statSync(main).size === 0) return null;
  const unread = (cause: unknown) => new LedgerUnread({ reason: cause instanceof Error ? cause.message : String(cause) });
  const scratch = yield* Effect.try({ try: () => mkdtempSync(join(dirname(main), '.ledger-')), catch: unread });
  return yield* Effect.gen(function* () {
    const at = join(scratch, 'read.sqlite');
    yield* cloneTree(main, at);
    if (existsSync(wal)) yield* cloneTree(wal, `${at}-wal`);
    return yield* Effect.try({ try: () => migrationsIn(at), catch: unread });
  }).pipe(Effect.ensuring(Effect.sync(() => rmSync(scratch, { recursive: true, force: true }))));
});

const servedByFrom = Effect.fnUntraced(
  function* (files: readonly string[]) {
    for (const path of files) {
      if ((yield* ledgerOf(path, `${path}-wal`)) !== (yield* ledgerOf(`${path}${KEPT}`, `${path}-wal${KEPT}`))) return false;
    }
    return true;
  },
  (effect) => {
    const unread = (failure: CloneFailed | LedgerUnread) =>
      Effect.sync(() => {
        console.error(`[tagma] the migrations standing in the data could not be read, so the copies go back: ${failure.message}`);
        return false;
      });
    return Effect.catchTags(effect, { CloneFailed: unread, LedgerUnread: unread });
  },
);

const settledOn = Effect.fnUntraced(function* (place: TrialPlace, record: Attempt, end: AttemptEnd) {
  const { installRoot } = place;
  if (end.data !== 'unrestored' && record.from !== null && currentVersion(installRoot) === record.to) swapCurrent(installRoot, record.from);
  writeAttempt(installRoot, { ...record, ended: end });
  if (end.data !== 'unrestored') yield* droppedAll(strays(place));
  console.error(`[tagma] the attempt on ${record.to} ended before its door opened (${end.data}): ${end.detail}`);
});

const rolled = Effect.fnUntraced(function* (place: TrialPlace, detail: string, words?: Words) {
  const version = ownVersion(place);
  const read = readAttempt(place.installRoot);
  if (Result.isFailure(read)) {
    console.error(`[tagma] the attempt cannot roll back, and its copies stay for the next start to set aside: ${read.failure.message}`);
    return;
  }
  const record = read.success;
  if (version === null || record === null || record.to !== version || currentVersion(place.installRoot) !== version) return;
  if (record.ended === null) {
    const data = record.copied ? yield* returnedAll(place) : 'untouched';
    return yield* settledOn(place, record, { detail, data, words, left: data === 'unrestored' ? leftAs(covered(place)) : undefined });
  }
  if (record.ended.data !== 'unrestored') return;
  const ended = { detail: record.ended.detail, words: record.ended.words };
  if (record.ended.left !== leftAs(covered(place)) && (yield* servedByFrom(covered(place))))
    return yield* settledOn(place, record, { ...ended, data: 'kept' });
  const data = yield* returnedAll(place);
  if (data === 'restored') yield* settledOn(place, record, { ...ended, data });
  else writeAttempt(place.installRoot, { ...record, ended: { ...ended, data, left: leftAs(covered(place)) } });
});

export const rollBack = Effect.fn('Trial.rollBack')(function* (place: TrialPlace, detail: string, words?: Words) {
  return yield* moving(place.installRoot, () => rolled(place, detail, words));
});

const copiedAll = (place: TrialPlace): Effect.Effect<void, TrialRefused> =>
  forEachFile(standing(place), kept).pipe(
    Effect.mapError(
      (failure) =>
        new TrialRefused({
          detail: `the data was not copied before the attempt: ${failure.path}: ${failure.reason}`,
          words: failure.step === 'space' && failure.needed !== undefined ? dataSpaceWords(failure.needed) : undefined,
        }),
    ),
  );

const entered = Effect.fnUntraced(function* (place: TrialPlace, version: string) {
  const { installRoot } = place;
  const read = readAttempt(installRoot);
  if (Result.isFailure(read)) {
    console.error(
      `[tagma] this start serves with no update attempt, and the copies stay for the next start to set aside: ${read.failure.message}`,
    );
    writeServed(installRoot, version);
    return null;
  }
  const record = read.success;
  const current = currentVersion(installRoot);
  const stale = staleOf(record, current, version);
  if (stale !== null) return yield* stale;
  writeServed(installRoot, version);
  if (record === null || record.to !== version || record.ended !== null || current !== version) return null;
  if (record.copied)
    yield* forEachFile(covered(place), returned).pipe(
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
      return moving(installRoot, () =>
        Effect.andThen(
          Effect.sync(() => passAttempt(installRoot, version)),
          droppedAll(strays(place)),
        ),
      );
    }).pipe(Effect.orDie),
    closing: (close) => {
      closings.push(close);
    },
    failed: (detail, words) =>
      Effect.suspend(() => {
        if (settled) return Effect.void;
        settled = true;
        return Effect.andThen(
          Effect.forEach(closings, Effect.exit, { discard: true }),
          rollBack(place, detail, words).pipe(
            Effect.catchTag('InstallHeld', (held) =>
              Effect.sync(() => console.error(`[tagma] the attempt waits for its next start to roll back: ${held.path}: ${held.reason}`)),
            ),
          ),
        );
      }),
  };
  return trial;
});

export const enterTrial = Effect.fn('Trial.enter')(function* (place: TrialPlace) {
  const version = ownVersion(place);
  if (version === null) return null;
  return yield* moving(place.installRoot, () => entered(place, version));
});
