import { Effect } from 'effect';
import { isAbsolute, resolve } from 'node:path';
import { entryAt } from '../entry.js';
import { pageRows } from '@runlith/paging';
import { body, pair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { CheckoutPlaces } from '../../workspace/contract/service/checkouts.js';
import { CallerWorkspace } from '../../workspace/contract/service/places.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { Directories } from '../contract/service/directories.js';
import { Documents } from '../contract/service/documents.js';
import { Entries } from '../contract/service/entries.js';
import { PathIndex } from '../contract/service/pathIndex.js';
import { Reveal } from '../contract/service/reveal.js';
import { WRITE_OPERATIONS as WRITES } from '../contract/wire/writes.js';
import { DIRECTORY, DIRECTORY_OPERATIONS as DIRECTORIES } from '../contract/wire/directory.js';
import { FIND_LIMIT, PATH_OPERATIONS as PATHS } from '../contract/wire/paths.js';
import { PLACE_OPERATIONS as PLACES } from '../contract/wire/place.js';
import { REVEAL_OPERATIONS as REVEALS } from '../contract/wire/reveal.js';

const placeOf = Effect.fn('checkout-files.place')(function* (root: string | undefined) {
  const call = yield* yield* CurrentProject;
  const workspace = yield* CallerWorkspace;
  return yield* (yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: workspace?.root }, root);
});

export const FILE_PAIRS = {
  read_directory: pair(
    DIRECTORIES.read_directory,
    body(DIRECTORIES.read_directory, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        const listed = yield* (yield* Directories).list(place, {
          path: input.path ?? '',
          ignored: input.ignored === true,
          rows: pageRows(input.limit, DIRECTORY, ceilingOf(DIRECTORY)),
          cursor: input.cursor,
        });
        return { status: 'ok' as const, entries: listed.rows, total: listed.total, next: listed.next };
      }),
    }),
  ),

  place_path: pair(
    PLACES.place_path,
    body(PLACES.place_path, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const workspace = yield* CallerWorkspace;
        const base =
          input.from ??
          (input.root === undefined || isAbsolute(input.path)
            ? undefined
            : (yield* (yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: workspace?.root }, input.root)).path) ??
          workspace?.root ??
          (isAbsolute(input.path)
            ? ''
            : (yield* (yield* CheckoutPlaces).placeOf({ projectId: call.project.id, cwd: undefined }, undefined)).path);
        const absolute = isAbsolute(input.path) ? resolve(input.path) : resolve(base, input.path);
        const entry = yield* entryAt(absolute);
        if (entry === null) return { status: 'ok' as const, entry: null, place: null };
        const placed = yield* (yield* Documents).placeOf(call.project.id, absolute);
        return {
          status: 'ok' as const,
          entry,
          place:
            placed === null
              ? null
              : { projectId: placed.projectId, checkout: RootId.make(placed.checkout), root: placed.root, path: placed.path },
        };
      }),
    }),
  ),

  write_document: pair(
    WRITES.write_document,
    body(WRITES.write_document, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        const saved = yield* (yield* Documents).save(place, {
          path: input.path,
          base: input.base,
          write: input.write,
          edits: input.edits,
          text: input.text,
        });
        return saved;
      }),
    }),
  ),

  write_file: pair(
    WRITES.write_file,
    body(WRITES.write_file, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const saved = yield* (yield* Documents).saveLoose(call.project.id, {
          path: input.path,
          base: input.base,
          write: input.write,
          edits: input.edits,
          text: input.text,
        });
        return saved.status === 'ok' ? { status: 'ok' as const, digest: saved.digest } : saved;
      }),
    }),
  ),

  create_entry: pair(
    WRITES.create_entry,
    body(WRITES.create_entry, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        return { status: 'ok' as const, ...(yield* (yield* Entries).create(place, input.path, input.kind)) };
      }),
    }),
  ),

  move_entries: pair(
    WRITES.move_entries,
    body(WRITES.move_entries, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        return { status: 'ok' as const, ...(yield* (yield* Entries).move(place, input.pairs)) };
      }),
    }),
  ),

  trash_entries: pair(
    WRITES.trash_entries,
    body(WRITES.trash_entries, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        return { status: 'ok' as const, ...(yield* (yield* Entries).trash(place, input.paths)) };
      }),
    }),
  ),

  restore_entries: pair(
    WRITES.restore_entries,
    body(WRITES.restore_entries, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        return { status: 'ok' as const, ...(yield* (yield* Entries).restore(place, input.trash)) };
      }),
    }),
  ),

  reveal_entry: pair(
    REVEALS.reveal_entry,
    body(REVEALS.reveal_entry, {
      execute: Effect.fnUntraced(function* (input) {
        if (input.root === undefined && isAbsolute(input.path)) {
          yield* (yield* Reveal).showLoose(input.path);
          return { status: 'ok' as const };
        }
        const place = yield* placeOf(input.root);
        yield* (yield* Reveal).show(place, input.path);
        return { status: 'ok' as const };
      }),
    }),
  ),

  find_files: pair(
    PATHS.find_files,
    body(PATHS.find_files, {
      execute: Effect.fnUntraced(function* (input) {
        const place = yield* placeOf(input.root);
        const found = yield* (yield* PathIndex).find(place, {
          query: input.query,
          limit: input.limit ?? FIND_LIMIT,
          recent: input.recent ?? [],
        });
        return { status: 'ok' as const, files: found.files, matched: found.matched };
      }),
    }),
  ),
};
