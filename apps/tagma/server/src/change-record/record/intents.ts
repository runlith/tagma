import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { type Listing, listingUnder, standing } from '@runlith/files/working';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { changeLogWrites, workspaceChange } from '../store/tables.js';
import type { Walks } from '../lines/walks.js';
import type { StoreShape } from './places.js';
import { releaseVersions } from './versions.js';

type Intent = {
  readonly id: string;
  readonly checkout: string;
  readonly path: string;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
};

type Standing =
  | { readonly kind: 'absent' }
  | { readonly kind: 'entry' }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly mode: string }
  | { readonly kind: 'unread' };

const missing = (cause: unknown): boolean =>
  cause instanceof Error && 'code' in cause && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR');

const standingAt = Effect.fnUntraced(function* (listing: Listing, spelled: string, origin: Intent['origin']): Effect.fn.Return<Standing> {
  const stood = yield* standing(spelled, listing);
  if (stood === 'absent') return { kind: 'absent' };
  if (stood !== 'stands') return { kind: 'unread' };
  const path = join(listing.root, spelled);
  const entry = yield* Effect.result(Effect.tryPromise(() => lstat(path)));
  if (entry._tag === 'Failure') return missing(entry.failure.cause) ? { kind: 'absent' } : { kind: 'unread' };
  if (origin === 'delete') return { kind: 'entry' };
  const info = entry.success;
  if (info.isSymbolicLink()) {
    const target = yield* Effect.result(Effect.tryPromise(() => readlink(path)));
    return target._tag === 'Success'
      ? { kind: 'bytes', bytes: new TextEncoder().encode(target.success), mode: '120000' }
      : { kind: 'unread' };
  }
  if (!info.isFile()) return { kind: 'unread' };
  const read = yield* Effect.result(Effect.tryPromise(() => readFile(path)));
  if (read._tag === 'Failure') return { kind: 'unread' };
  return { kind: 'bytes', bytes: read.success, mode: (info.mode & 0o111) === 0 ? '100644' : '100755' };
});

type RootAt = { readonly kind: 'active'; readonly listing: Listing } | { readonly kind: 'gone' } | { readonly kind: 'unknown' };

const rootAt = (roots: FileRoots['Service'], checkout: string): Effect.Effect<RootAt> =>
  Effect.map(Effect.result(roots.read(RootId.make(checkout))), (read): RootAt => {
    if (read._tag === 'Success')
      return read.success.state === 'active' ? { kind: 'active', listing: listingUnder(read.success.path) } : { kind: 'gone' };
    return read.failure._tag === 'RootMissing' ? { kind: 'gone' } : { kind: 'unknown' };
  });

export type IntentsSettled = { readonly confirmed: number; readonly withdrawn: number; readonly unread: number };

export const settleIntents = Effect.fn('ChangeRecord.settleIntents')(function* (
  units: MachineUnits['Service'],
  store: StoreShape,
  roots: FileRoots['Service'],
  walks: Walks,
): Effect.fn.Return<IntentsSettled, StoreFailure> {
  const intents: readonly Intent[] = yield* units.read((unit) =>
    unit.run(
      store.db
        .select({
          id: workspaceChange.id,
          checkout: workspaceChange.checkout,
          path: workspaceChange.path,
          origin: workspaceChange.origin,
          beforeHash: workspaceChange.beforeHash,
          afterHash: workspaceChange.afterHash,
        })
        .from(workspaceChange)
        .where(eq(workspaceChange.state, 'writing')),
    ),
  );
  if (intents.length === 0) return { confirmed: 0, withdrawn: 0, unread: 0 };
  const confirmed = new Map<string | null, string[]>();
  const withdrawn: string[] = [];
  let unread = 0;
  const rootsAt = new Map<string, RootAt>();
  for (const intent of intents) {
    const known = rootsAt.get(intent.checkout);
    const root = known ?? (yield* rootAt(roots, intent.checkout));
    rootsAt.set(intent.checkout, root);
    if (root.kind === 'unknown') {
      unread += 1;
      continue;
    }
    if (root.kind === 'gone') {
      withdrawn.push(intent.id);
      continue;
    }
    const stood = yield* standingAt(root.listing, intent.path, intent.origin);
    if (stood.kind === 'unread') {
      unread += 1;
      continue;
    }
    if (stood.kind === 'absent') {
      if (intent.origin === 'delete') confirmed.set(null, [...(confirmed.get(null) ?? []), intent.id]);
      else withdrawn.push(intent.id);
      continue;
    }
    if (stood.kind === 'entry') {
      withdrawn.push(intent.id);
      continue;
    }
    const answer = yield* Effect.result(walks.digests([stood.bytes]));
    if (answer._tag === 'Failure') {
      yield* Effect.logWarning('a write intent stays unsettled: its file could not be digested', {
        intent: intent.id,
        reason: answer.failure.message,
      });
    }
    const digest = answer._tag === 'Success' ? (answer.success[0] ?? null) : null;
    if (digest === null) {
      unread += 1;
      continue;
    }
    if (intent.origin !== 'delete' && digest === intent.afterHash)
      confirmed.set(stood.mode, [...(confirmed.get(stood.mode) ?? []), intent.id]);
    else withdrawn.push(intent.id);
  }
  yield* units.write(changeLogWrites, () =>
    Effect.gen(function* () {
      for (const [mode, ids] of confirmed) {
        yield* store.db
          .update(workspaceChange)
          .set({ state: 'held', mode })
          .where(and(inArray(workspaceChange.id, ids), eq(workspaceChange.state, 'writing')));
      }
      if (withdrawn.length > 0) {
        const gone = yield* store.db
          .delete(workspaceChange)
          .where(and(inArray(workspaceChange.id, withdrawn), eq(workspaceChange.state, 'writing')))
          .returning({ before: workspaceChange.beforeHash, after: workspaceChange.afterHash });
        yield* releaseVersions(
          store.db,
          gone.flatMap((row) => [row.before, row.after]),
        );
      }
    }),
  );
  return { confirmed: [...confirmed.values()].reduce((total, ids) => total + ids.length, 0), withdrawn: withdrawn.length, unread };
});
