import { join } from 'node:path';
import { Clock, Effect } from 'effect';
import type { IntakeFact } from '../../change-record/contract/service/intake.js';
import type { Entries } from '../contract/service/entries.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import { EMPTY, type EntryRecord, type Kind, type Refused, kindAt, outermost, parentsOf, refuse, undone } from '../entries/record.js';
import type { Targets } from '../tree/target.js';
import {
  type GitDirs,
  ID,
  type Manifest,
  type TrashActs,
  dropped,
  entriesIn,
  freshId,
  gone,
  keepManifest,
  manifestAt,
  relocated,
  trashIn,
} from './place.js';

type Moving = { readonly from: string; readonly to: string; readonly shown: string };

type Moved = { readonly left: readonly string[] };

const putBack = (done: readonly Moving[]): Effect.Effect<readonly string[]> =>
  Effect.forEach([...done].reverse(), (one) =>
    Effect.gen(function* () {
      const back = yield* Effect.result(relocated(one.to, one.from));
      if (back._tag === 'Success') return [] as readonly string[];
      yield* Effect.logWarning('a trashed entry could not be put back', { path: one.shown, reason: back.failure.reason });
      return [one.shown] as readonly string[];
    }),
  ).pipe(Effect.map((left) => left.flat()));

const relocatedAll = Effect.fnUntraced(function* (moves: readonly Moving[]) {
  const done: Moving[] = [];
  const left: string[] = [];
  for (const one of moves) {
    const step = yield* Effect.result(Effect.andThen(parentsOf(one.to), relocated(one.from, one.to)));
    if (step._tag === 'Failure') return yield* Effect.fail({ refused: step.failure, stranded: yield* putBack(done) });
    if (step.success.left !== null) left.push(step.success.left);
    done.push(one);
  }
  return { left } satisfies Moved;
});

const cleared = (home: string, why: string): Effect.Effect<void> =>
  Effect.flatMap(Effect.result(dropped(home)), (gone) =>
    gone._tag === 'Success'
      ? Effect.void
      : Effect.andThen(
          Effect.annotateCurrentSpan({ uncleared: home }),
          Effect.logWarning(`${why}; the sweep removes it later`, { home, reason: gone.failure.message }),
        ),
  );

const remainder = (what: string, left: readonly string[]): Effect.Effect<void> =>
  left.length === 0
    ? Effect.void
    : Effect.andThen(
        Effect.annotateCurrentSpan({ left: left.length }),
        Effect.logWarning(`${what}: copied across volumes, but these sources could not be removed and still stand`, { left }),
      );

export const makeCheckoutTrash = (input: {
  readonly record: EntryRecord;
  readonly targets: Targets;
  readonly gitDirs: GitDirs;
  readonly acts: TrashActs;
}) => {
  const { record, targets, gitDirs, acts } = input;

  const restored = Effect.fnUntraced(function* (place: ProjectRoot, id: string, home: string) {
    const kept = yield* manifestAt(home);
    if (kept.kind === 'absent') return yield* gone(id);
    if (kept.kind === 'unreadable') {
      return yield* refuse('files', `the trash act ${id} cannot be read: ${kept.reason}`, 'restore its entries by hand from the trash');
    }
    const { manifest } = kept;
    const resolved = yield* Effect.forEach(manifest.entries, (entry) => targets.of(place, entry.path, 'entry'));
    const abs = (relative: string): string => join(place.path, relative);
    const left: string[] = [];
    const unconfirmed = yield* record.turns(
      place.projectId,
      [...manifest.files.map((file) => abs(file.path)), ...resolved.map((one) => one.abs)],
      Effect.gen(function* () {
        for (const target of resolved) {
          if ((yield* kindAt(target.abs)) !== null) {
            return yield* refuse('target-exists', `${target.relative} is taken again`, 'move or delete what stands there, then restore');
          }
        }
        const at = new Date(yield* Clock.currentTimeMillis);
        const facts = manifest.files.map((file): IntakeFact => ({
          origin: 'write',
          path: abs(file.path),
          at,
          before: EMPTY,
          after: file.digest,
        }));
        const write = relocatedAll(
          resolved.map((target) => ({ from: join(entriesIn(home), target.key), to: target.abs, shown: target.relative })),
        ).pipe(
          Effect.mapError(({ refused, stranded }) => undone(refused, stranded)),
          Effect.map((moved) => {
            left.push(...moved.left);
            return true;
          }),
        );
        return yield* record.land(place.projectId, facts, write, () => gone(id));
      }),
    );
    yield* remainder('a restore from the trash', left);
    yield* cleared(home, 'a restored trash act could not be removed');
    return { paths: resolved.map((one) => one.relative), unconfirmed };
  });

  const trash: Entries['Service']['trash'] = Effect.fn('Entries.trash')(function* (place, asked) {
    yield* Effect.annotateCurrentSpan({ paths: asked.length });
    const resolved = yield* Effect.forEach(asked, (path) => targets.of(place, path, 'entry'));
    const outer = outermost(resolved.map((one) => one.key));
    const id = freshId();
    const home = join(trashIn(yield* gitDirs.of(place.path)), id);
    const abs = (relative: string): string => join(place.path, relative);
    const listed = yield* record.committable(place.path, outer);
    const left: string[] = [];
    const acted = yield* acts.holding(
      home,
      record.turns(
        place.projectId,
        [...listed, ...outer].map(abs),
        Effect.gen(function* () {
          const kinds: Kind[] = [];
          for (const relative of outer) {
            const kind = yield* kindAt(abs(relative));
            if (kind === null) return yield* refuse('source-moved', `${relative} is gone`, 'refresh the tree and try again');
            kinds.push(kind);
          }
          const now = new Set(yield* record.committable(place.path, outer));
          const files = [...now];
          const digests = yield* record.digests(files.map(abs));
          const kept = files.flatMap((path) => {
            const digest = digests.get(abs(path));
            return digest === undefined ? [] : [{ path, digest }];
          });
          const at = new Date(yield* Clock.currentTimeMillis);
          const facts = kept.map((file): IntakeFact => ({ origin: 'delete', path: abs(file.path), at, before: file.digest }));
          const manifest: Manifest = {
            at: at.getTime(),
            entries: outer.map((path, index) => ({ path, kind: kinds[index] as Kind })),
            files: kept,
          };
          const write = Effect.gen(function* () {
            yield* keepManifest(home, manifest);
            const moved = yield* Effect.result(
              relocatedAll(outer.map((path) => ({ from: abs(path), to: join(entriesIn(home), path), shown: path }))),
            );
            if (moved._tag === 'Failure') {
              const { refused, stranded } = moved.failure;
              if (stranded.length === 0) yield* cleared(home, 'an abandoned trash act could not be removed');
              return yield* undone(
                refused,
                stranded.map((path) => join(entriesIn(home), path)),
              );
            }
            left.push(...moved.success.left);
            return true;
          });
          return yield* record.land(place.projectId, facts, write, () =>
            refuse('source-moved', 'an entry changed while it was deleted', 'refresh the tree and try again'),
          );
        }),
      ),
    );
    yield* remainder('a deletion into the trash', left);
    return { trash: id, unconfirmed: acted };
  });

  const restore: Entries['Service']['restore'] = Effect.fn('Entries.restore')(function* (place, id) {
    if (!ID.test(id)) return yield* gone(id);
    const home = join(trashIn(yield* gitDirs.of(place.path)), id);
    return yield* acts.holding(home, restored(place, id, home));
  });

  return { trash, restore };
};

export type CheckoutTrash = { readonly trash: Entries['Service']['trash']; readonly restore: Entries['Service']['restore'] };
