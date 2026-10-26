import { lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import { changeOf } from '@runlith/files/change';
import type { IntakeFact } from '../../change-record/contract/service/intake.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { Entries } from '../contract/service/entries.js';
import type { EntryMove } from '../contract/wire/writes.js';
import type { Target, Targets } from '../tree/target.js';
import type { CheckoutTrash } from '../trash/bin.js';
import { EMPTY, type EntryRecord, type Refused, codeOf, fsAct, kindAt, moved, parentsOf, refuse, underneath, undone } from './record.js';

type Pair = { readonly from: Target; readonly to: Target };

type File = { readonly from: string; readonly to: string };

const ATTEMPTS = 3;

const createdEmpty = (path: string): Effect.Effect<boolean, Refused> =>
  fsAct(path, async () => {
    try {
      await (await open(path, 'wx')).close();
      return true;
    } catch (cause) {
      if (codeOf(cause) === 'EEXIST') return false;
      throw cause;
    }
  });

const sameEntry = (one: string, other: string): Effect.Effect<boolean, Refused> =>
  Effect.map(
    Effect.tryPromise({
      try: () => Promise.all([lstat(one), lstat(other)]),
      catch: (cause) => refuse('files', `${one} or ${other} could not be read: ${String(cause)}`, 'read the report and retry'),
    }),
    ([left, right]) => left.ino === right.ino && left.dev === right.dev,
  );

const taken = (pair: Pair): Effect.Effect<boolean, Refused> =>
  Effect.flatMap(kindAt(pair.to.abs), (kind) =>
    kind === null ? Effect.succeed(false) : Effect.map(sameEntry(pair.from.abs, pair.to.abs), (same) => !same),
  );

const standing = Effect.fnUntraced(function* (pair: Pair) {
  if ((yield* kindAt(pair.from.abs)) === null)
    return yield* refuse('source-moved', `${pair.from.relative} is gone`, 'refresh the tree and try again');
  if (yield* taken(pair)) return yield* refuse('target-exists', `${pair.to.relative} already exists`, 'choose another path');
});

const putBack = (done: readonly Pair[]): Effect.Effect<readonly string[]> =>
  Effect.forEach([...done].reverse(), (pair) =>
    Effect.gen(function* () {
      const back = yield* Effect.result(moved(pair.to.abs, pair.from.abs));
      if (back._tag === 'Success') return [] as readonly string[];
      yield* Effect.logWarning('an entry that moved could not be put back', { path: pair.to.relative, reason: back.failure.reason });
      return [pair.to.relative] as readonly string[];
    }),
  ).pipe(Effect.map((left) => left.flat()));

const renamedAll = Effect.fnUntraced(function* (pairs: readonly Pair[]) {
  const done: Pair[] = [];
  for (const pair of pairs) {
    const step = yield* Effect.result(
      Effect.andThen(standing(pair), Effect.andThen(parentsOf(pair.to.abs), moved(pair.from.abs, pair.to.abs))),
    );
    if (step._tag === 'Failure') return yield* undone(step.failure, yield* putBack(done));
    done.push(pair);
  }
  return true;
});

const crossing = (pairs: readonly Pair[]): Refused | null => {
  for (const pair of pairs) {
    if (pair.from.key === pair.to.key) return refuse('same-path', `${pair.from.relative} would move onto itself`, 'name a different path');
    if (underneath(pair.to.key, pair.from.key))
      return refuse('target-exists', `${pair.from.relative} cannot move into itself`, 'choose a place outside it');
    for (const other of pairs) {
      if (other === pair) continue;
      if (underneath(pair.to.key, other.to.key) || underneath(other.to.key, pair.to.key)) {
        return refuse(
          'target-exists',
          `${pair.to.relative} and ${other.to.relative} would land inside one another`,
          'give each a path of its own',
        );
      }
      if (underneath(pair.to.key, other.from.key)) {
        return refuse(
          'target-exists',
          `${pair.to.relative} lies inside ${other.from.relative}, which moves too`,
          'move them in separate acts',
        );
      }
    }
  }
  return null;
};

export const makeTreeEntries = (input: { readonly record: EntryRecord; readonly bin: CheckoutTrash; readonly targets: Targets }) => {
  const { record, bin, targets } = input;

  const filesOf = (place: ProjectRoot, pairs: readonly Pair[], listed: readonly string[]): readonly File[] =>
    listed.flatMap((path) => {
      const pair = pairs.find((one) => underneath(path, one.from.key));
      return pair === undefined
        ? []
        : [{ from: join(place.path, path), to: join(place.path, pair.to.key + path.slice(pair.from.key.length)) }];
    });

  const attempt = Effect.fnUntraced(function* (place: ProjectRoot, pairs: readonly Pair[]) {
    const froms = pairs.map((pair) => pair.from.key);
    const listed = yield* record.committable(place.path, froms);
    const files = filesOf(place, pairs, listed);
    return yield* record.turns(
      place.projectId,
      [...files.flatMap((file) => [file.from, file.to]), ...pairs.flatMap((pair) => [pair.from.abs, pair.to.abs])],
      Effect.gen(function* () {
        const known = new Set(listed);
        if ((yield* record.committable(place.path, froms)).some((path) => !known.has(path))) return null;
        yield* Effect.forEach(pairs, standing, { discard: true });
        const digests = yield* record.digests(files.map((file) => file.from));
        const at = new Date(yield* Clock.currentTimeMillis);
        const facts = files.flatMap((file): IntakeFact[] => {
          const digest = digests.get(file.from);
          if (digest === undefined) return [];
          return [
            { origin: 'delete', path: file.from, at, before: digest },
            { origin: 'write', path: file.to, at, before: EMPTY, after: digest, movedFrom: file.from },
          ];
        });
        const unconfirmed = yield* record.land(place.projectId, facts, renamedAll(pairs), () =>
          refuse('source-moved', 'an entry changed while it moved', 'refresh the tree and try again'),
        );
        return { moved: pairs.map((pair): EntryMove => ({ from: pair.from.relative, to: pair.to.relative })), unconfirmed };
      }),
    );
  });

  return Entries.of({
    trash: bin.trash,

    restore: bin.restore,

    create: Effect.fn('Entries.create')(function* (place, path, kind) {
      yield* Effect.annotateCurrentSpan({ kind });
      const target = yield* targets.of(place, path, 'entry');
      const exists = (): Refused => refuse('target-exists', `${target.relative} already exists`, 'choose another name');
      if ((yield* kindAt(target.abs)) !== null) return yield* exists();
      if (kind === 'directory') {
        yield* fsAct(target.abs, () => mkdir(target.abs, { recursive: true }));
        return { path: target.relative, unconfirmed: null };
      }
      yield* parentsOf(target.abs);
      const fact = changeOf('write', target.abs, { absent: true }, '', '', false, new Date(yield* Clock.currentTimeMillis));
      const unconfirmed = yield* record.turns(
        place.projectId,
        [target.abs],
        record.land(place.projectId, [fact], createdEmpty(target.abs), exists),
      );
      return { path: target.relative, unconfirmed };
    }),

    move: Effect.fn('Entries.move')(function* (place, asked) {
      yield* Effect.annotateCurrentSpan({ pairs: asked.length });
      const resolved = yield* Effect.forEach(asked, (pair) =>
        Effect.all({ from: targets.of(place, pair.from, 'entry'), to: targets.of(place, pair.to, 'entry') }),
      );
      const pairs = resolved.filter(
        (pair) =>
          !resolved.some((other) => other !== pair && other.from.key !== pair.from.key && underneath(pair.from.key, other.from.key)),
      );
      const crossed = crossing(pairs);
      if (crossed !== null) return yield* crossed;
      for (let attemptAt = 1; ; attemptAt += 1) {
        const outcome = yield* attempt(place, pairs);
        if (outcome !== null) return outcome;
        if (attemptAt >= ATTEMPTS) {
          return yield* refuse('source-moved', 'files kept appearing under the entries while they moved', 'retry once the writing stops');
        }
      }
    }),
  });
};
